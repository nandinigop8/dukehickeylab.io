/*
 * Endometrial GRN Explorer -- Fertile LH+7 vs RIF LH+7 territory view.
 *
 * Data: data/<compartment>_graph.json, built by
 *   ../script/build_territory_graph.py
 * Every union edge carries its coef_mean in each of the 6 CellOracle groups
 * (null = absent from that group's top-2,000 network). Gained/lost/retained
 * is derived from presence in Fertile_LH+7 vs RIF_LH+7; the build script
 * checks this against the exported diff files.
 *
 * Rendering: graphology (graph model) + sigma.js v3 (WebGL). Territory halos
 * and highways are drawn on an extra 2D canvas layer under sigma's edges.
 */
(async function () {
  "use strict";

  const COMPARTMENT = "stromal";
  const F = 2; // index of Fertile_LH+7 in data.groups
  const R = 5; // index of RIF_LH+7

  // sigma blends with premultiplied alpha, so translucent edge colors must be
  // premultiplied too -- otherwise faint gray edges stack up to white.
  const pm = (r, g, b, a) => `rgba(${Math.round(r * a)},${Math.round(g * a)},${Math.round(b * a)},${a})`;
  const C = {
    retained: pm(150, 150, 162, 0.22),
    retainedHi: pm(215, 215, 225, 0.85),
    gained: pm(90, 160, 255, 0.8),
    lost: pm(255, 107, 106, 0.8),
    dim: "#232329",
    absent: "#3a3a42",
    tf: "#8f7ff0",
    target: "#ffa07a",
  };
  const TIER_COLOR = { strong: "#4ade80", moderate: "#facc15", limited: "#fb923c", none: "#52525b" };
  const LIT_TIERS = new Set(["strong", "moderate"]);  // "literature-supported gene" = >= 3 papers or a curated note
  const HWY = {
    retained: "rgba(170,170,182,0.26)",
    gained: "rgba(90,160,255,0.42)",
    lost: "rgba(255,107,106,0.42)",
  };

  const state = {
    mode: "both",        // both | fertile | rif
    sizeBy: "fertile",   // fertile | rif | delta
    colorBy: "territory",
    onlyChanged: false,
    highways: true,
    cross: false,
    lit: "off",          // off | genes | edges
    hovered: null,
    selected: null,
    territory: null,
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v, d = 3) => (v == null ? "—" : v.toFixed(d));

  // ---------------------------------------------------------------- load
  let data;
  try {
    const res = await fetch(`data/${COMPARTMENT}_graph.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $("loading").textContent = `Could not load data/${COMPARTMENT}_graph.json (${err.message}). Run ../script/serve_local.sh and open this page through http://127.0.0.1.`;
    return;
  }
  // Literature annotations are optional: the map still works without them.
  let ann = {}, litEdges = {}, annSources = null;
  try {
    const [ra, rl] = await Promise.all([fetch(`data/${COMPARTMENT}_annotations.json`), fetch("data/literature_edges.json")]);
    if (ra.ok) { const j = await ra.json(); ann = j.genes; annSources = j.sources; }
    if (rl.ok) litEdges = (await rl.json()).edges;
  } catch (err) {
    console.warn("Literature annotations not loaded:", err);
  }
  $("loading").remove();
  $("compartment-label").textContent = COMPARTMENT[0].toUpperCase() + COMPARTMENT.slice(1);

  const T = data.territories;
  const Graph = graphology.Graph || graphology;
  const graph = new Graph({ type: "directed", multi: false });

  for (const n of data.nodes) {
    const A = ann[n.id] || {};
    const tier = A.tier || "none";
    graph.addNode(n.id, {
      ...n, label: n.id, size: 2, color: C.absent,
      tier, litGene: LIT_TIERS.has(tier) || !!A.note,
      candidate: (n.hub || n.woiRank != null || n.rifRank != null) && !LIT_TIERS.has(tier) && !A.note,
    });
  }

  // 95th percentile of |coef| sets the top of the edge-width scale.
  const allCoefs = [];
  for (const [, , c] of data.edges) for (const g of [F, R]) if (c[g] != null) allCoefs.push(Math.abs(c[g]));
  allCoefs.sort((a, b) => a - b);
  const coefCap = allCoefs[Math.floor(allCoefs.length * 0.95)] || 1;

  for (const [s, t, c] of data.edges) {
    const a = data.nodes[s], b = data.nodes[t];
    const inF = c[F] != null, inR = c[R] != null;
    const status = inF && inR ? "retained" : inF ? "lost" : inR ? "gained" : null;
    const lit = litEdges[`${a.id}>${b.id}`] || null;
    graph.addDirectedEdge(a.id, b.id, {
      status, inF, inR, cF: c[F], cR: c[R],
      sm: a.m, tm: b.m, cross: a.m !== b.m,
      lit,
      litGenes: graph.getNodeAttribute(a.id, "litGene") && graph.getNodeAttribute(b.id, "litGene"),
      size: 0.5, color: C.retained,
    });
  }

  // ---------------------------------------------------------------- rules
  function edgeShown(a) {
    if (!a.status) return false;
    if (state.mode === "fertile" && !a.inF) return false;
    if (state.mode === "rif" && !a.inR) return false;
    if (state.onlyChanged && a.status === "retained") return false;
    if (state.lit === "genes" && !a.litGenes) return false;
    if (state.lit === "edges" && !a.lit) return false;
    return true;
  }
  function nodePresent(n) {
    const f = n.eig[F] != null, r = n.eig[R] != null;
    return state.mode === "fertile" ? f : state.mode === "rif" ? r : f || r;
  }
  function nodeSize(n) {
    const f = n.eig[F], r = n.eig[R];
    if (state.sizeBy === "delta") {
      if (f == null && r == null) return 1.4;
      return 1.8 + 20 * Math.sqrt(Math.abs((r ?? 0) - (f ?? 0)));
    }
    const v = state.sizeBy === "fertile" ? f : r;
    return v == null ? 1.6 : 2 + 13 * Math.sqrt(v);
  }
  function nodeColor(n) {
    if (state.colorBy === "tf") return n.tf ? C.tf : C.target;
    if (state.colorBy === "evidence") return TIER_COLOR[n.tier];
    return T[n.m].color;
  }
  function edgeWidth(a) {
    const v = state.mode === "fertile" ? Math.abs(a.cF ?? 0)
      : state.mode === "rif" ? Math.abs(a.cR ?? 0)
      : Math.max(Math.abs(a.cF ?? 0), Math.abs(a.cR ?? 0));
    return 0.35 + 2.6 * Math.min(1, v / coefCap);
  }

  // Genes on at least one literature-supported edge in the current view.
  let litNodes = new Set();
  function computeLitNodes() {
    litNodes = new Set();
    graph.forEachEdge((e, a, s, t) => { if (a.lit && edgeShown(a)) { litNodes.add(s); litNodes.add(t); } });
  }

  let focusSet = null;
  function focusNode() { return state.hovered || state.selected; }
  function computeFocus() {
    const f = focusNode();
    if (!f) { focusSet = null; return; }
    focusSet = new Set([f]);
    graph.forEachEdge(f, (e, a, s, t) => { if (edgeShown(a)) { focusSet.add(s); focusSet.add(t); } });
  }

  // ---------------------------------------------------------------- sigma
  function drawHover(ctx, d, s) {
    const label = d.label || d.key;
    if (!label) return;
    const size = s.labelSize + 1;
    ctx.font = `600 ${size}px ${s.labelFont}`;
    const w = ctx.measureText(label).width;
    const x = d.x + d.size + 6, y = d.y;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.size + 3, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "rgba(24,24,29,0.94)";
    ctx.strokeStyle = "#3a3a44";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - 5, y - size / 2 - 5, w + 10, size + 10, 6);
    else ctx.rect(x - 5, y - size / 2 - 5, w + 10, size + 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x, y + size / 3);
  }

  const container = $("stage");
  const renderer = new Sigma(graph, container, {
    zIndex: true,
    defaultEdgeType: "line",
    labelFont: "Inter, system-ui, sans-serif",
    labelSize: 12,
    labelWeight: "500",
    labelColor: { color: "#d6d5dc" },
    labelDensity: 0.6,
    labelGridCellSize: 90,
    labelRenderedSizeThreshold: 10,
    defaultDrawNodeHover: drawHover,
    minCameraRatio: 0.03,
    maxCameraRatio: 3,
    stagePadding: 30,
    nodeReducer(node, attr) {
      const res = { ...attr };
      const present = nodePresent(attr);
      res.size = nodeSize(attr);
      res.color = present ? nodeColor(attr) : C.absent;
      res.zIndex = 1;
      if (!present) { res.label = ""; res.size = 1.3; res.zIndex = 0; }
      else if (attr.hub) { res.forceLabel = true; res.zIndex = 2; }
      const litOut = (state.lit === "genes" && !attr.litGene) || (state.lit === "edges" && !litNodes.has(node));
      if (litOut) { res.color = C.dim; res.label = ""; res.forceLabel = false; res.zIndex = 0; }

      if (focusSet) {
        if (focusSet.has(node)) {
          res.forceLabel = true;
          res.label = attr.id;
          res.zIndex = 3;
          if (!present) res.color = C.absent;
        } else {
          res.color = C.dim; res.label = ""; res.forceLabel = false; res.zIndex = 0;
        }
      } else if (state.territory != null && attr.m !== state.territory) {
        res.color = C.dim; res.label = ""; res.forceLabel = false; res.zIndex = 0;
      }
      return res;
    },
    edgeReducer(edge, attr) {
      if (!edgeShown(attr)) return { ...attr, hidden: true };
      const res = { ...attr, color: C[attr.status], size: edgeWidth(attr), zIndex: attr.status === "retained" ? 0 : 1 };
      const f = focusNode();
      if (f) {
        const s = graph.source(edge), t = graph.target(edge);
        if (s === f || t === f) {
          res.type = "arrow";
          res.size = res.size * 1.5 + 0.6;
          if (attr.status === "retained") res.color = C.retainedHi;
          res.zIndex = 3;
        } else {
          res.hidden = true;
        }
        return res;
      }
      if (state.territory != null) {
        const inside = attr.sm === state.territory && attr.tm === state.territory;
        const touches = attr.sm === state.territory || attr.tm === state.territory;
        if (!(inside || (state.cross && touches))) res.hidden = true;
        return res;
      }
      if (attr.cross && !state.cross) res.hidden = true;
      return res;
    },
  });

  // Frame the map on the territory halos (not just the nodes) so halos and
  // their titles are never clipped; a fixed frame also means dragging a node
  // never rescales the map.
  const pad = 1.15;
  renderer.setCustomBBox({
    x: [Math.min(...T.map((t) => t.x - t.r * pad)), Math.max(...T.map((t) => t.x + t.r * pad))],
    y: [Math.min(...T.map((t) => t.y - t.r * pad)), Math.max(...T.map((t) => t.y + t.r * pad)) + 2.5],
  });
  const camera = renderer.getCamera();

  // ---------------------------------------------------------------- halos + highways
  const halo = renderer.createCanvas("territories", { beforeLayer: "edges" });
  Object.assign(halo.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  // CPU-backed 2D contexts for the overlay layers: on some GPU backends an
  // accelerated canvas re-showed a stale frame after being cleared (seen as a
  // ghost selection ring). These layers draw only a few shapes per frame.
  const OVERLAY_CTX = { willReadFrequently: true };
  const hctx = halo.getContext("2d", OVERLAY_CTX);

  const HIGHWAYS_PER_TERRITORY = 3;
  let highways = [];
  function computeHighways() {
    const acc = new Map();
    graph.forEachEdge((e, a) => {
      if (!a.cross || !edgeShown(a)) return;
      const i = Math.min(a.sm, a.tm), j = Math.max(a.sm, a.tm);
      const k = i * 1000 + j;
      if (!acc.has(k)) acc.set(k, { a: i, b: j, retained: 0, gained: 0, lost: 0, total: 0 });
      const h = acc.get(k);
      h[a.status]++; h.total++;
    });
    highways = [...acc.values()].filter((h) => h.total >= 2).sort((x, y) => x.total - y.total);
    // Overview shows only each territory's strongest links; selecting a
    // territory shows all of its highways.
    const keep = new Set();
    T.forEach((t, i) => {
      highways.filter((h) => h.a === i || h.b === i)
        .sort((x, y) => y.total - x.total).slice(0, HIGHWAYS_PER_TERRITORY)
        .forEach((h) => keep.add(h));
    });
    for (const h of highways) h.major = keep.has(h);
  }

  function hexA(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function vp(x, y) { return renderer.graphToViewport({ x, y }); }

  function drawOverlay() {
    const w = container.offsetWidth, h = container.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    if (halo.width !== Math.round(w * dpr) || halo.height !== Math.round(h * dpr)) {
      halo.width = Math.round(w * dpr);
      halo.height = Math.round(h * dpr);
    }
    const ctx = hctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const geo = T.map((t) => {
      const c = vp(t.x, t.y), e = vp(t.x + t.r * 1.1, t.y);
      return { c, r: Math.hypot(e.x - c.x, e.y - c.y) };
    });
    const focusT = state.territory;
    const gene = focusNode();

    // Territory halos.
    T.forEach((t, i) => {
      const { c, r } = geo[i];
      const faded = (focusT != null && focusT !== i) || gene;
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      g.addColorStop(0, hexA(t.color, faded ? 0.05 : 0.14));
      g.addColorStop(0.75, hexA(t.color, faded ? 0.025 : 0.06));
      g.addColorStop(1, hexA(t.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = hexA(t.color, faded ? 0.1 : focusT === i ? 0.6 : 0.22);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.97, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    });

    // Highways: one curved "road" per territory pair, split into
    // lost | retained | gained lanes whose widths follow the edge counts.
    if (state.highways && !gene) {
      for (const hw of highways) {
        if (focusT != null ? hw.a !== focusT && hw.b !== focusT : !hw.major) continue;
        const A = geo[hw.a], B = geo[hw.b];
        const dx = B.c.x - A.c.x, dy = B.c.y - A.c.y;
        const len = Math.hypot(dx, dy);
        if (len < A.r + B.r + 4) continue;
        const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
        const sx = A.c.x + ux * A.r * 0.92, sy = A.c.y + uy * A.r * 0.92;
        const ex = B.c.x - ux * B.r * 0.92, ey = B.c.y - uy * B.r * 0.92;
        const bend = 0.12 * (len - A.r - B.r);
        const mx = (sx + ex) / 2 + nx * bend, my = (sy + ey) / 2 + ny * bend;
        const W = Math.min(16, 1 + 1.0 * Math.sqrt(hw.total));
        let off = -W / 2;
        for (const lane of ["lost", "retained", "gained"]) {
          if (!hw[lane]) continue;
          const lw = (W * hw[lane]) / hw.total;
          const o = off + lw / 2;
          off += lw;
          ctx.strokeStyle = HWY[lane];
          ctx.lineWidth = Math.max(0.8, lw);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(sx + nx * o, sy + ny * o);
          ctx.quadraticCurveTo(mx + nx * o, my + ny * o, ex + nx * o, ey + ny * o);
          ctx.stroke();
        }
        if (focusT != null) {
          const lx = 0.25 * sx + 0.5 * mx + 0.25 * ex, ly = 0.25 * sy + 0.5 * my + 0.25 * ey;
          ctx.font = "500 10.5px JetBrains Mono, monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(200,200,210,0.75)";
          ctx.fillText(String(hw.total), lx + nx * (W / 2 + 8), ly + ny * (W / 2 + 8) + 3);
        }
      }
    }

    // Territory titles above each halo.
    ctx.textAlign = "center";
    T.forEach((t, i) => {
      const { c, r } = geo[i];
      if (r < 28) return;
      const faded = (focusT != null && focusT !== i) || gene;
      ctx.font = "600 12px Inter, system-ui, sans-serif";
      ctx.fillStyle = hexA(t.color, faded ? 0.3 : 0.95);
      ctx.fillText(`${t.hub} territory`, c.x, c.y - r - 14);
      ctx.font = "400 11px Inter, system-ui, sans-serif";
      ctx.fillStyle = faded ? "rgba(140,140,150,0.3)" : "rgba(160,160,170,0.8)";
      ctx.fillText(`${t.size} genes`, c.x, c.y - r - 1);
    });
  }
  // Selection ring on its own layer above the labels. (sigma's built-in
  // "highlighted" state is only repainted on hover, so a cleared selection
  // left a stale ring behind; this layer is redrawn on every frame.)
  const selLayer = renderer.createCanvas("selection", { afterLayer: "labels" });
  Object.assign(selLayer.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  const sctx = selLayer.getContext("2d", OVERLAY_CTX);
  function drawSelection() {
    const w = container.offsetWidth, h = container.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    if (selLayer.width !== Math.round(w * dpr) || selLayer.height !== Math.round(h * dpr)) {
      selLayer.width = Math.round(w * dpr);
      selLayer.height = Math.round(h * dpr);
    }
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, w, h);
    const id = state.selected;
    if (!id || !graph.hasNode(id)) return;
    const d = renderer.getNodeDisplayData(id);
    if (!d) return;
    const v = renderer.framedGraphToViewport(d);
    const r = renderer.scaleSize(d.size) + 4;
    sctx.beginPath();
    sctx.arc(v.x, v.y, r, 0, Math.PI * 2);
    sctx.strokeStyle = "rgba(255,255,255,0.9)";
    sctx.lineWidth = 2;
    sctx.stroke();
    sctx.beginPath();
    sctx.arc(v.x, v.y, r + 5, 0, Math.PI * 2);
    sctx.strokeStyle = "rgba(255,255,255,0.25)";
    sctx.lineWidth = 1;
    sctx.stroke();
  }
  renderer.on("afterRender", () => { drawOverlay(); drawSelection(); });

  // ---------------------------------------------------------------- territory summaries
  const tStats = T.map(() => ({ gained: 0, lost: 0, retained: 0, inGained: 0, inLost: 0, inRetained: 0 }));
  graph.forEachEdge((e, a) => {
    if (!a.status) return;
    for (const m of new Set([a.sm, a.tm])) tStats[m][a.status]++;
    if (!a.cross) tStats[a.sm]["in" + a.status[0].toUpperCase() + a.status.slice(1)]++;
  });

  // ---------------------------------------------------------------- right panel
  const detail = $("detail");

  // Vocabulary used everywhere in the UI (keep consistent):
  //   gene = dot, link = line (regulator -> target), territory = gene group,
  //   road = bundle of links between territories, importance = eigenvector
  //   centrality, "in both" / "new in RIF" / "missing in RIF" = edge status.
  const STATUS_TEXT = { retained: "In both", gained: "New in RIF", lost: "Missing in RIF" };
  const signed = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d));

  function geneListItems(list, right, title) {
    return list.map((g) => `
      <li data-gene="${esc(g.id)}" title="${esc(title ? title(g) : "Show " + g.id)}">
        <span class="st" style="background:${T[g.m].color}"></span>
        <span>${esc(g.id)}</span>
        <span class="cf">${right(g)}</span>
      </li>`).join("");
  }

  function territoryListHTML() {
    const present = graph.filterNodes((n, a) => a.eig[F] != null || a.eig[R] != null).map((n) => graph.getNodeAttributes(n));
    const known = present.filter((a) => a.tf && a.litGene)
      .sort((x, y) => (ann[y.id]?.nImpl || 0) - (ann[x.id]?.nImpl || 0)).slice(0, 12);
    const rankOf = (a) => Math.min(a.rifRank ?? 99, a.woiRank ?? 99);
    const cands = present.filter((a) => a.candidate)
      .sort((x, y) => rankOf(x) - rankOf(y) || (x.hub ? -1 : 1)).slice(0, 12);
    const why = (a) => a.hub ? "territory hub"
      : a.rifRank != null && (a.woiRank == null || a.rifRank <= a.woiRank) ? `top changer in RIF #${a.rifRank}` : `top changer across cycle #${a.woiRank}`;
    return `
      <div class="detail-section">
      <h2><span class="badge">A</span>Territories</h2>
      <p class="hint">Gene groups, named after their hub · click to zoom</p>
      <div class="t-head"><span></span><span>Hub gene · size</span><span>Links <span class="up">new</span> / <span class="down">missing</span> in RIF</span></div>
      <ul class="territories">
        ${T.map((t, i) => `
          <li data-t="${i}" class="${state.territory === i ? "on" : ""}" title="Zoom into the ${esc(t.hub)} territory">
            <span class="t-dot" style="background:${t.color}"></span>
            <span class="t-name">${esc(t.hub)}<span class="t-meta">${t.size} genes</span></span>
            <span class="t-chg"><span class="up">+${tStats[i].gained}</span> <span class="down">−${tStats[i].lost}</span></span>
          </li>`).join("")}
      </ul>
      </div>
      <div class="detail-section">
        <h2><span class="badge">B</span>Known implantation regulators</h2>
        <p class="hint">Regulators with 3+ implantation papers</p>
        <div class="list-head"><span>Gene</span><span>Papers</span></div>
        <ul class="edge-list">${geneListItems(known, (a) => ann[a.id]?.nImpl ?? 0)}</ul>
      </div>
      <div class="detail-section">
        <h2><span class="badge">C</span>Novel candidates</h2>
        <p class="hint">Central here, little research · leads, not findings</p>
        <div class="list-head"><span>Gene</span><span>Why it stands out</span></div>
        <ul class="edge-list">${geneListItems(cands, why)}</ul>
      </div>`;
  }

  function edgeRows(list) {
    const shown = list.slice(0, 25);
    if (!list.length) return `<p class="more">None with the current settings.</p>`;
    return `<div class="list-head"><span></span><span title="Model estimate of link strength in the fertile and RIF networks">fertile → RIF</span></div>
      <ul class="edge-list">${shown.map((x) => `
        <li data-gene="${esc(x.other)}" title="${esc(STATUS_TEXT[x.status])}. Click to show ${esc(x.other)}.">
          <span class="st ${x.status}"></span>
          <span>${esc(x.other)}${litBadge(x.lit)}</span>
          <span class="cf">${signed(x.cF)} → ${signed(x.cR)}</span>
        </li>`).join("")}</ul>${list.length > shown.length ? `<p class="more">+${list.length - shown.length} more (strongest shown first)</p>` : ""}`;
  }

  const pubmed = (p) => `<a href="https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(p)}/" target="_blank" rel="noopener" title="Open on PubMed">PMID ${esc(p)}</a>`;
  const TIER_TEXT = { strong: "Strong", moderate: "Moderate", limited: "Limited", none: "None found" };
  const TIER_EXPLAIN = {
    strong: "10 or more papers on implantation or decidualization mention this gene.",
    moderate: "3–9 papers on implantation or decidualization mention this gene.",
    limited: "1–2 papers on implantation or decidualization mention this gene.",
    none: "No papers on implantation or decidualization found for this gene.",
  };

  // Gene explanation, in a fixed order:
  //   Name (alternative names) -> Function in implantation/receptivity ->
  //   General function -> Literature findings/experiments.
  // Each is a collapsible card; open/closed state carries over between genes.
  const secOpen = { A: true, B: true, C: false, D: false };
  const section = (num, title, body, extra = "") =>
    `<details class="gsec" data-sec="${num}" ${secOpen[num] ? "open" : ""}>
      <summary><h4><span class="badge">${num}</span>${title}${extra}<span class="chev">▶</span></h4></summary>
      <div class="gsec-body">${body}</div></details>`;

  function aboutHTML(id, n) {
    const A = ann[id];
    if (!A) return `<div class="muted-box">No literature information for this gene.</div>`;
    const driver = n.hub || n.woiRank != null || n.rifRank != null;

    // 1. Name (alternative names): short symbols first, then up to 2 names.
    const alt = [...(A.aliases || []).slice(0, 6),
      ...(A.otherNames || []).filter((x) => x.toLowerCase() !== (A.name || "").toLowerCase() && x.length <= 60).slice(0, 2)];
    const s1 = section("A", "Name", `
      <p class="gname">${A.name ? esc(A.name) : esc(id)}</p>
      ${alt.length ? `<p class="galt"><span class="muted">Also known as</span> ${alt.map(esc).join(", ")}</p>` : ""}`);

    // 2. Function in implantation / receptivity
    let body2;
    if (A.note) {
      const reviewed = A.note.status === "reviewed";
      body2 = `<p class="gtext">${esc(A.note.text)}</p>
        <p class="note-src"><span class="status ${reviewed ? "reviewed" : ""}" title="${reviewed ? "Checked by the lab" : "Written from the cited papers; not yet checked by the lab"}">${reviewed ? `Reviewed${A.note.reviewer ? " · " + esc(A.note.reviewer) : ""}` : "Draft"}</span> · ${A.note.cites.map((c) => pubmed(c.pmid)).join(" · ")}</p>`;
    } else if (A.rifsImpl.length) {
      body2 = `<p class="muted">No summary yet. See findings in section D.</p>`;
    } else {
      body2 = `<p class="muted">No known role in implantation.${driver ? ` <span class="tag cand" title="Central in this map but little implantation research">Novel candidate</span>` : ""}</p>`;
    }
    const s2 = section("B", "Function in implantation", body2);

    // 3. General function
    const summ = A.summary || "";
    const cut = summ.length > 260 ? summ.lastIndexOf(" ", 240) : -1;
    const s3 = section("C", "General function", summ
      ? (cut > 0
        ? `<div class="gtext" title="NCBI Gene summary"><span class="g-short">${esc(summ.slice(0, cut))}… </span><span class="g-full" hidden>${esc(summ)} </span><button class="linklike g-more">more</button></div>`
        : `<div class="gtext" title="NCBI Gene summary">${esc(summ)}</div>`)
      : `<p class="muted">No NCBI description${A.type && A.type !== "protein-coding" ? ` (${esc(A.type)})` : ""}.</p>`);

    // 4. Literature findings / experiments
    const known = [];
    graph.forEachEdge(id, (e, a, s, tg) => { if (a.lit) known.push({ s, t: tg, lit: a.lit }); });
    const p4 = [];
    if (A.rifsImpl.length) {
      p4.push(`<p class="sub-h" title="One-line summaries curated by NCBI (GeneRIF), newest first">Implantation findings · ${A.nRifsImpl}</p>
        <ul class="rifs">${A.rifsImpl.slice(0, 3).map((r) => `<li>${esc(r.text)} ${pubmed(r.pmid)}</li>`).join("")}</ul>`);
    }
    if (known.length) {
      p4.push(`<p class="sub-h" title="Regulator → target links in this map also reported in experiments (CollecTRI database)">Links confirmed by experiments · ${known.length}</p>
        <ul class="rifs">${known.slice(0, 5).map((k) => `<li>${esc(k.s)} → ${esc(k.t)} ${litBadge(k.lit)} ${k.lit.refs[0] ? pubmed(k.lit.refs[0]) : ""}</li>`).join("")}</ul>`);
    }
    if (A.papers.length) {
      p4.push(`<p class="sub-h">Latest papers</p><p class="pmids">${A.papers.map((p) => pubmed(p.pmid)).join("")}</p>`);
    }
    if (A.rifsEndo.length) {
      p4.push(`<details class="summary"><summary>Other uterine-lining findings</summary>
        <ul class="rifs">${A.rifsEndo.map((r) => `<li>${esc(r.text)} ${pubmed(r.pmid)}</li>`).join("")}</ul></details>`);
    }
    if (!p4.length) p4.push(`<p class="muted">No implantation papers found.</p>`);
    const badge = ` <span class="ev-badge ${A.tier}" title="${esc(TIER_EXPLAIN[A.tier])} (automatic count from NCBI Gene)">${TIER_TEXT[A.tier]} · ${A.nImpl}</span>`;
    const s4 = section("D", "Literature", p4.join(""), badge);
    return `<div class="about">${s1}${s2}${s3}${s4}</div>`;
  }

  function litBadge(l) {
    if (!l) return "";
    const cls = l.sign === "+" ? "pos" : l.sign === "-" ? "neg" : "";
    const what = l.sign === "+" ? "switches it on" : l.sign === "-" ? "switches it off" : "regulates it";
    return `<span class="lit ${cls}" title="Known link: published experiments report that the regulator ${what} (CollecTRI, ${l.nRefs} reference${l.nRefs === 1 ? "" : "s"})">known${l.sign === "+" ? " ↑" : l.sign === "-" ? " ↓" : ""}</span>`;
  }

  function geneHTML(id) {
    const n = graph.getNodeAttributes(id);
    const t = T[n.m];
    const outs = [], ins = [];
    graph.forEachOutEdge(id, (e, a, s, tg) => { if (edgeShown(a)) outs.push({ other: tg, ...a }); });
    graph.forEachInEdge(id, (e, a, s) => { if (edgeShown(a)) ins.push({ other: s, ...a }); });
    const mag = (x) => Math.max(Math.abs(x.cF ?? 0), Math.abs(x.cR ?? 0));
    outs.sort((x, y) => mag(y) - mag(x));
    ins.sort((x, y) => mag(y) - mag(x));
    const eF = n.eig[F], eR = n.eig[R];
    const dF = n.deg[F], dR = n.deg[R];
    const diff = (a, b, d) => (a == null && b == null ? "—" : signed((b ?? 0) - (a ?? 0), d));
    const A = ann[id] || {};
    const tags = [
      `<span class="tag strong" style="border-color:${t.color};color:${t.color}" title="The gene group this gene belongs to">${esc(t.hub)} territory</span>`,
      n.hub ? `<span class="tag strong" title="The most connected regulator of its territory">Territory hub</span>` : "",
      n.dual === true ? `<span class="tag strong" title="Identified as a key regulator by both network methods in this study (CellOracle and dynGENIE3)">Confirmed by 2 methods</span>` : "",
      n.dual === null ? `<span class="tag" title="The second method could not be run for this cell type">2nd method not available</span>` : "",
      n.rifRank ? `<span class="tag" title="Among the 20 genes whose importance differs most between fertile and RIF">Top changer in RIF #${n.rifRank}</span>` : "",
      n.woiRank ? `<span class="tag" title="Among the 20 genes whose importance shifts most across LH+3 to LH+11 in fertile women">Top changer across cycle #${n.woiRank}</span>` : "",
      n.curated ? `<span class="tag" title="Shown in the published static figure">In paper figure</span>` : "",
      n.candidate ? `<span class="tag cand" title="Central in this map but little implantation research">Novel candidate</span>` : "",
    ].join("");
    const legend = `<div class="mini-legend"><span><i style="background:var(--retained)"></i>in both</span><span><i style="background:var(--gained)"></i>new in RIF</span><span><i style="background:var(--lost)"></i>missing in RIF</span><span title="Link strength = model estimate: + switches the target on, − switches it off, — no link">+ on · − off</span></div>`;
    return `
      <button class="back" data-back>← Back to overview</button>
      <div class="gene-head"><h3>${esc(id)}</h3><span class="role-pill ${n.tf ? "tf" : ""}" title="${n.tf ? "A transcription factor: can switch other genes on or off" : "Only regulated by other genes in this analysis"}">${n.tf ? "Regulator (TF)" : "Target gene"}</span></div>
      ${aboutHTML(id, n)}
      <div class="detail-section">
      <h2><span class="badge">E</span>In this network</h2>
      <div class="tags">${tags}</div>
      <dl class="kv2">
        <dt class="h"></dt><dd class="h">Fertile</dd><dd class="h">RIF</dd><dd class="h">Change</dd>
        <dt class="k" title="How central the gene is (eigenvector centrality, 0–1)">Importance</dt><dd class="v">${fmt(eF)}</dd><dd class="v">${fmt(eR)}</dd><dd class="v">${diff(eF, eR, 3)}</dd>
        <dt class="k" title="Number of links to other genes">Number of links</dt><dd class="v">${dF ?? "—"}</dd><dd class="v">${dR ?? "—"}</dd><dd class="v">${diff(dF, dR, 0)}</dd>
      </dl>
      </div>
      <div class="detail-section">
        <h2><span class="badge">F</span>Gene links</h2>
        ${legend}
        <p class="sub-h">Controls · ${outs.length}</p>
        ${n.tf ? edgeRows(outs) : `<p class="more">Target genes don't control others here.</p>`}
        <p class="sub-h">Controlled by · ${ins.length}</p>
        ${edgeRows(ins)}
      </div>`;
  }

  function territoryHTML(i) {
    const t = T[i], s = tStats[i];
    const links = highways.filter((h) => h.a === i || h.b === i)
      .map((h) => ({ other: h.a === i ? h.b : h.a, ...h }))
      .sort((x, y) => y.total - x.total);
    const genes = graph.filterNodes((n, a) => a.m === i && (a.eig[F] != null || a.eig[R] != null))
      .map((n) => {
        const a = graph.getNodeAttributes(n);
        return { id: n, d: (a.eig[R] ?? 0) - (a.eig[F] ?? 0) };
      })
      .sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 12);
    return `
      <button class="back" data-back>← Back to overview</button>
      <div class="gene-head"><h3 style="color:${t.color}">${esc(t.hub)} territory</h3></div>
      <p class="fullname">${t.size} genes · hub <a href="#" data-gene="${esc(t.hub)}">${esc(t.hub)}</a></p>
      <div class="detail-section">
      <h2><span class="badge">A</span>Links</h2>
      <dl class="kv2" style="grid-template-columns: 1fr auto auto">
        <dt class="h"></dt><dd class="h" title="Both genes inside this territory">Inside</dd><dd class="h" title="At least one gene inside this territory">Touching</dd>
        <dt class="k">In both</dt><dd class="v">${s.inRetained}</dd><dd class="v">${s.retained}</dd>
        <dt class="k up">New in RIF</dt><dd class="v">${s.inGained}</dd><dd class="v">${s.gained}</dd>
        <dt class="k down">Missing in RIF</dt><dd class="v">${s.inLost}</dd><dd class="v">${s.lost}</dd>
      </dl>
      </div>
      <div class="detail-section">
        <h2><span class="badge">B</span>Roads to other territories</h2>
        <div class="list-head"><span>Territory</span><span>Links · <span class="up">new</span> / <span class="down">missing</span></span></div>
        <ul class="edge-list">${links.map((h) => `
          <li data-t="${h.other}" title="Go to the ${esc(T[h.other].hub)} territory">
            <span class="st" style="background:${T[h.other].color}"></span>
            <span>${esc(T[h.other].hub)}</span>
            <span class="cf">${h.total} · <span class="up">+${h.gained}</span> <span class="down">−${h.lost}</span></span>
          </li>`).join("") || `<p class="more">None with the current settings.</p>`}</ul>
      </div>
      <div class="detail-section">
        <h2><span class="badge">C</span>Genes whose importance changes most</h2>
        <div class="list-head"><span></span><span title="Blue = more important in RIF, red = less">RIF − fertile</span></div>
        <ul class="edge-list">${genes.map((g) => `
          <li data-gene="${esc(g.id)}" title="${g.d >= 0 ? "More" : "Less"} important in RIF">
            <span class="st ${g.d >= 0 ? "gained" : "lost"}"></span>
            <span>${esc(g.id)}</span>
            <span class="cf">${signed(g.d, 3)}</span>
          </li>`).join("")}</ul>

      </div>`;
  }

  function renderDetail() {
    if (state.selected) detail.innerHTML = geneHTML(state.selected);
    else if (state.territory != null) detail.innerHTML = territoryHTML(state.territory);
    else detail.innerHTML = territoryListHTML();
  }

  detail.addEventListener("toggle", (ev) => {
    const s = ev.target.closest && ev.target.closest(".gsec");
    if (s && ev.target === s) secOpen[s.dataset.sec] = s.open;
  }, true);

  detail.addEventListener("click", (ev) => {
    const more = ev.target.closest(".g-more");
    if (more) {
      const box = more.parentElement;
      const open = box.querySelector(".g-full").hidden;
      box.querySelector(".g-full").hidden = !open;
      box.querySelector(".g-short").hidden = open;
      more.textContent = open ? "less" : "more";
      return;
    }
    const back = ev.target.closest("[data-back]");
    if (back) { state.selected = null; state.territory = null; update(); camera.animatedReset({ duration: 500 }); return; }
    const g = ev.target.closest("[data-gene]");
    if (g) { ev.preventDefault(); selectGene(g.dataset.gene, true); return; }
    const t = ev.target.closest("[data-t]");
    if (t) selectTerritory(+t.dataset.t);
  });

  // ---------------------------------------------------------------- stats
  function renderStats() {
    const cnt = { retained: 0, gained: 0, lost: 0 };
    let cross = 0, lit = 0;
    graph.forEachEdge((e, a) => { if (edgeShown(a)) { cnt[a.status]++; if (a.cross) cross++; if (a.lit) lit++; } });
    const genes = graph.filterNodes((n, a) => nodePresent(a)).length;
    $("stats").innerHTML = `
      <h2><span class="badge">7</span>Currently shown</h2>
      <div><span>Genes</span><b>${genes.toLocaleString()}</b></div>
      <div><span>Links in both</span><b>${cnt.retained.toLocaleString()}</b></div>
      <div><span class="up">New in RIF</span><b>${cnt.gained.toLocaleString()}</b></div>
      <div><span class="down">Missing in RIF</span><b>${cnt.lost.toLocaleString()}</b></div>
      <div><span>Between territories</span><b>${cross.toLocaleString()}</b></div>
      <div><span>Known links</span><b>${lit.toLocaleString()}</b></div>`;
  }

  const MODE_HINT = {
    both: "Line colour = change in RIF",
    fertile: "Red = missing in RIF",
    rif: "Blue = new in RIF",
  };
  const SIZE_HINT = {
    fertile: "Bigger = more central in fertile",
    rif: "Bigger = more central in RIF",
    delta: "Bigger = bigger change",
  };
  const COLOR_HINT = {
    territory: "One colour per territory",
    tf: "Purple regulator · orange target",
    evidence: "Green strong · yellow moderate · orange limited",
  };
  const LIT_HINT = {
    off: "No filter",
    genes: "Genes with 3+ implantation papers",
    edges: "Links reported in experiments",
  };
  const DOT_LEGEND = {
    territory: () => "",
    tf: () => `<li><span class="sw dot tf"></span>Regulator (TF)</li><li><span class="sw dot target"></span>Target gene</li>`,
    evidence: () => `<li><span class="sw dot ev-strong"></span>Strong (10+ papers)</li><li><span class="sw dot ev-moderate"></span>Moderate (3–9)</li><li><span class="sw dot ev-limited"></span>Limited (1–2)</li><li><span class="sw dot ev-none"></span>None found</li>`,
  };

  function update() {
    computeLitNodes();
    computeFocus();
    computeHighways();
    renderer.refresh();
    // Repaint the selection ring now as well: a frame already queued by a
    // camera animation can absorb this refresh and render before the state
    // change, which would otherwise leave the old ring on screen.
    drawSelection();
    renderStats();
    renderDetail();
    $("mode-hint").textContent = MODE_HINT[state.mode];
    $("size-hint").textContent = SIZE_HINT[state.sizeBy];
    $("color-hint").textContent = COLOR_HINT[state.colorBy];
    $("lit-hint").textContent = LIT_HINT[state.lit];
    $("legend-dots").innerHTML = DOT_LEGEND[state.colorBy]();
  }

  // ---------------------------------------------------------------- camera helpers
  const bbox = renderer.getCustomBBox();  // the halo frame set above
  const extent = Math.max(bbox.x[1] - bbox.x[0], bbox.y[1] - bbox.y[0]);

  function focusCamera(x, y, ratio) {
    // Framed-graph coordinates come from a node's display data; use a
    // territory's hub (always at its centre) or the gene itself.
    camera.animate({ x, y, ratio }, { duration: 600 });
  }
  function selectTerritory(i) {
    state.territory = i;
    state.selected = null;
    update();
    const d = renderer.getNodeDisplayData(T[i].hub);
    focusCamera(d.x, d.y, Math.min(1, (T[i].r * 3.0) / extent));
  }
  function selectGene(id, zoom) {
    if (!graph.hasNode(id)) return;
    state.selected = id;
    state.territory = null;
    update();
    if (zoom) {
      const d = renderer.getNodeDisplayData(id);
      focusCamera(d.x, d.y, Math.min(camera.ratio, 0.35));
    }
  }

  // ---------------------------------------------------------------- events
  renderer.on("enterNode", ({ node }) => { state.hovered = node; computeFocus(); renderer.refresh(); container.style.cursor = "pointer"; });
  renderer.on("leaveNode", () => { state.hovered = null; computeFocus(); renderer.refresh(); container.style.cursor = ""; });
  renderer.on("clickNode", ({ node }) => {
    if (dragMoved) return;
    if (state.selected === node) { state.selected = null; update(); } else selectGene(node, false);
  });
  renderer.on("clickStage", ({ event }) => {
    const p = renderer.viewportToGraph({ x: event.x, y: event.y });
    const hit = T.findIndex((t) => Math.hypot(p.x - t.x, p.y - t.y) <= t.r * 1.1);
    if (hit >= 0 && hit !== state.territory) selectTerritory(hit);
    else if (state.selected || state.territory != null) {
      state.selected = null; state.territory = null; update();
    }
  });

  // Obsidian-style drag: pull a gene around, it springs back on release.
  let dragged = null, dragMoved = false, home = null;
  renderer.on("downNode", ({ node }) => {
    dragged = node; dragMoved = false;
    home = { x: graph.getNodeAttribute(node, "x"), y: graph.getNodeAttribute(node, "y") };
  });
  const captor = renderer.getMouseCaptor();
  captor.on("mousemovebody", (e) => {
    if (!dragged) return;
    const p = renderer.viewportToGraph(e);
    graph.mergeNodeAttributes(dragged, { x: p.x, y: p.y });
    dragMoved = true;
    e.preventSigmaDefault();
    e.original.preventDefault();
    e.original.stopPropagation();
  });
  captor.on("mouseup", () => {
    if (!dragged) return;
    const node = dragged, from = { x: graph.getNodeAttribute(node, "x"), y: graph.getNodeAttribute(node, "y") }, to = home;
    dragged = null;
    const t0 = performance.now();
    (function step(now) {
      const k = Math.min(1, (now - t0) / 450);
      const ease = 1 - Math.pow(1 - k, 3) * Math.cos(k * Math.PI * 1.5);
      graph.mergeNodeAttributes(node, { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease });
      if (k < 1) requestAnimationFrame(step);
      else setTimeout(() => { dragMoved = false; }, 0);
    })(t0);
  });

  function bindSeg(id, key) {
    const el = $(id);
    el.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      state[key] = b.dataset.v;
      update();
    });
  }
  bindSeg("mode", "mode");
  bindSeg("sizeby", "sizeBy");
  bindSeg("colorby", "colorBy");
  bindSeg("lit", "lit");
  for (const [id, key] of [["only-changed", "onlyChanged"], ["show-highways", "highways"], ["show-cross", "cross"]]) {
    $(id).addEventListener("change", (ev) => { state[key] = ev.target.checked; update(); });
  }

  $("zoom-in").onclick = () => camera.animatedZoom({ duration: 250 });
  $("zoom-out").onclick = () => camera.animatedUnzoom({ duration: 250 });
  $("zoom-reset").onclick = () => camera.animatedReset({ duration: 400 });

  // Gene search.
  $("gene-list").innerHTML = graph.nodes().sort().map((n) => `<option value="${esc(n)}">`).join("");
  const search = $("search");
  function runSearch() {
    const q = search.value.trim().toUpperCase();
    if (!q) return;
    const hit = graph.nodes().find((n) => n.toUpperCase() === q);
    if (hit) selectGene(hit, true);
  }
  search.addEventListener("change", runSearch);
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !help.open) { state.selected = null; state.territory = null; update(); }
    if (e.key === "/" && document.activeElement !== search) { e.preventDefault(); search.focus(); }
  });

  // ---------------------------------------------------------------- resizable sidebars
  // Drag the thin bars beside the panels; widths are remembered per browser.
  // Double-click (or Home key) resets; arrow keys nudge for keyboard users.
  const layoutEl = document.querySelector(".layout");
  const LIMITS = { left: [190, 480, 350], right: [260, 620, 350] };  // min, max, default
  const cssVar = { left: "--lw", right: "--rw" };
  function setWidth(side, px, save) {
    const [lo, hi] = LIMITS[side];
    const w = Math.round(Math.max(lo, Math.min(hi, px)));
    layoutEl.style.setProperty(cssVar[side], w + "px");
    document.querySelector(`.resizer[data-side="${side}"]`).setAttribute("aria-valuenow", w);
    if (save) { try { localStorage.setItem("grn-w-" + side, String(w)); } catch (e) { /* ignore */ } }
  }
  for (const side of ["left", "right"]) {
    let saved = null;
    try { saved = Number(localStorage.getItem("grn-w-" + side)); } catch (e) { /* ignore */ }
    setWidth(side, saved || LIMITS[side][2], false);
  }
  // Panel visibility: the entry page passes ?ui=desktop|tablet|phone, which
  // sets the opening widths (phone starts with both panels closed). The two
  // top-bar buttons toggle them afterwards; the choice is remembered.
  function setPanel(side, open, save = true) {
    document.body.classList.toggle("hide-" + side, !open);
    const btn = document.getElementById("toggle-" + side);
    if (btn) btn.setAttribute("aria-expanded", String(open));
    if (save) { try { localStorage.setItem("grn-open-" + side, open ? "1" : "0"); } catch (e) { /* ignore */ } }
    renderer.resize(); renderer.refresh();
  }
  const UI_PRESET = { desktop: { w: [350, 350], open: true }, tablet: { w: [300, 320], open: true }, phone: { w: [300, 320], open: false } };
  const askedUi = new URLSearchParams(location.search).get("ui");
  if (askedUi && UI_PRESET[askedUi]) {
    const preset = UI_PRESET[askedUi];
    setWidth("left", preset.w[0], true);
    setWidth("right", preset.w[1], true);
    setPanel("left", preset.open);
    setPanel("right", preset.open);
    // Applied once: drop ?ui= so a reload or bookmark keeps what the visitor
    // then chose here instead of snapping back to the preset.
    history.replaceState(null, "", location.pathname + location.hash);
  } else {
    for (const side of ["left", "right"]) {
      let open = true;
      try { open = localStorage.getItem("grn-open-" + side) !== "0"; } catch (e) { /* ignore */ }
      setPanel(side, open, false);
    }
  }
  for (const side of ["left", "right"]) {
    const btn = document.getElementById("toggle-" + side);
    if (btn) btn.onclick = () => setPanel(side, document.body.classList.contains("hide-" + side));
  }

  document.querySelectorAll(".resizer").forEach((bar) => {
    const side = bar.dataset.side;
    const panel = document.querySelector(`.panel.${side}`);
    bar.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      bar.classList.add("dragging");
      document.body.classList.add("resizing");
      const startX = e.clientX, startW = panel.getBoundingClientRect().width;
      const move = (ev) => setWidth(side, side === "left" ? startW + (ev.clientX - startX) : startW - (ev.clientX - startX), false);
      const up = () => {
        bar.releasePointerCapture(e.pointerId);
        bar.classList.remove("dragging");
        document.body.classList.remove("resizing");
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        setWidth(side, panel.getBoundingClientRect().width, true);
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
    });
    bar.addEventListener("dblclick", () => setWidth(side, LIMITS[side][2], true));
    bar.addEventListener("keydown", (e) => {
      const w = panel.getBoundingClientRect().width, dir = side === "left" ? 1 : -1;
      if (e.key === "ArrowRight") setWidth(side, w + 16 * dir, true);
      else if (e.key === "ArrowLeft") setWidth(side, w - 16 * dir, true);
      else if (e.key === "Home") setWidth(side, LIMITS[side][2], true);
      else return;
      e.preventDefault();
    });
  });
  // Keep the map filling its column while panels are resized.
  new ResizeObserver(() => { renderer.resize(); renderer.refresh(); }).observe(container);

  // ---------------------------------------------------------------- help
  const help = $("help");
  const openHelp = (section) => {
    if (typeof help.showModal === "function") help.showModal(); else help.setAttribute("open", "");
    const sec = section && $("help-" + section);
    if (sec) { if (sec.tagName === "DETAILS") sec.open = true; sec.scrollIntoView({ block: "center" }); }
  };
  const closeHelp = () => {
    if (typeof help.close === "function") help.close(); else help.removeAttribute("open");
    try { localStorage.setItem("grn-help-seen", "1"); } catch (e) { /* storage unavailable */ }
  };
  $("help-open").onclick = () => openHelp();
  $("help-close").onclick = closeHelp;
  $("help-done").onclick = closeHelp;
  help.addEventListener("cancel", () => { try { localStorage.setItem("grn-help-seen", "1"); } catch (e) { /* ignore */ } });
  help.addEventListener("click", (e) => { if (e.target === help) closeHelp(); });  // click on backdrop
  document.querySelectorAll("[data-help]").forEach((b) => { b.onclick = () => openHelp(b.dataset.help); });
  let seen = false;
  try { seen = localStorage.getItem("grn-help-seen") === "1"; } catch (e) { /* ignore */ }
  if (!seen) openHelp();

  // The one-line tip on the map fades once the visitor has interacted.
  const tip = $("stage-tip");
  const hideTip = () => { tip.style.transition = "opacity .6s"; tip.style.opacity = "0"; };
  renderer.on("enterNode", hideTip);
  renderer.on("clickStage", hideTip);

  update();
  // Read-only handle used by script/tests/browser_smoke.js (and handy in the console).
  window.grnDebug = { state, graph, renderer, selLayer };
})();
