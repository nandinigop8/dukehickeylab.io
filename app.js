// ===================== state =====================
const FERTILE_ORDER = ["Fertile_LH+3","Fertile_LH+5","Fertile_LH+7","Fertile_LH+9","Fertile_LH+11"];
const FERTILE_LABELS = ["LH+3","LH+5","LH+7","LH+9","LH+11"];

let state = {
  comp: "stromal",
  mode: "woi",          // "woi" | "rif"
  tpIndex: 2,           // index into FERTILE_ORDER, default LH+7
  selectedGene: null,
  playing: false
};

let layoutCache = {};   // comp -> {id: {x,y}}
let simNodes = {};

const svg = d3.select("#graph-svg");
const gEdges = svg.append("g").attr("class", "edges-g");
const gNodes = svg.append("g").attr("class", "nodes-g");
let W = 900, H = 680;

function measureCanvas(){
  const pane = document.querySelector(".graph-pane");
  const rect = pane.getBoundingClientRect();
  W = Math.max(500, Math.round(rect.width) - 4);
  H = Math.max(420, Math.round(rect.height) - 4);
  svg.attr("viewBox", `0 0 ${W} ${H}`);
}

// ===================== layout (computed once per compartment) =====================
function computeLayout(comp){
  const d = GRN_DATA[comp];
  const nodes = d.nodes.map(n => ({...n}));
  // union of all edges across all clusters, deduped
  const edgeSet = new Map();
  d.edges.forEach(e => {
    const key = e.s + "->" + e.t;
    if(!edgeSet.has(key)) edgeSet.set(key, {source:e.s, target:e.t});
  });
  const links = Array.from(edgeSet.values());

  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(n => n.id).distance(Math.max(90, W*0.13)).strength(0.3))
    .force("charge", d3.forceManyBody().strength(-Math.max(260, W*0.35)))
    .force("center", d3.forceCenter(W/2, H/2))
    .force("collide", d3.forceCollide(46))
    .stop();

  for(let i=0;i<300;i++) sim.tick();

  const pos = {};
  nodes.forEach(n => { pos[n.id] = {x: n.x, y: n.y}; });
  return pos;
}

function getLayout(comp){
  if(!layoutCache[comp]) layoutCache[comp] = computeLayout(comp);
  return layoutCache[comp];
}

// ===================== rendering =====================
function currentCluster(){
  if(state.mode === "rif") return null; // rif mode shows two clusters at once via diff
  return FERTILE_ORDER[state.tpIndex];
}

function nodeColor(n){
  if(n.dual) return null; // handled via ring, fill still by tf/target
  return n.tf ? "var(--tf)" : "var(--target)";
}

function render(){
  const d = GRN_DATA[state.comp];
  const pos = getLayout(state.comp);
  const cluster = state.mode === "woi" ? FERTILE_ORDER[state.tpIndex] : "Fertile_LH+7";
  const rifCluster = "RIF_LH+7";

  // --- determine edges to draw ---
  let edgesToDraw = [];
  if(state.mode === "woi"){
    edgesToDraw = d.edges.filter(e => e.cluster === cluster).map(e => ({...e, color: null, isDiff:false}));
  } else {
    // Fertile_LH+7 vs RIF_LH+7 : union of edges from both, colored by diff status
    const seen = new Set();
    const fertileEdges = d.edges.filter(e => e.cluster === "Fertile_LH+7");
    const rifEdges = d.edges.filter(e => e.cluster === rifCluster);
    [...fertileEdges, ...rifEdges].forEach(e => {
      const key = e.s+"__"+e.t;
      if(seen.has(key)) return;
      seen.add(key);
      const status = d.rif_diff[key] || "retained";
      edgesToDraw.push({...e, statusKey:key, status});
    });
  }

  // --- centrality for node sizing ---
  const centMap = d.centrality[state.mode === "woi" ? cluster : "RIF_LH+7"] || {};
  const centMapFertile = d.centrality["Fertile_LH+7"] || {};

  // node degree in current edge set -> isolated detection
  const connected = new Set();
  edgesToDraw.forEach(e => { connected.add(e.s); connected.add(e.t); });

  const nodesData = d.nodes.map(n => ({
    ...n,
    x: pos[n.id].x, y: pos[n.id].y,
    cent: (state.mode === "woi" ? (centMap[n.id]||0) : Math.max(centMap[n.id]||0, centMapFertile[n.id]||0)),
    isolated: !connected.has(n.id)
  }));

  const rScale = d3.scaleSqrt().domain([0, 0.9]).range([8, 38]);
  const wScale = d3.scaleLinear().domain([0, 0.7]).range([1.5, 11]).clamp(true);

  // --- EDGES ---
  const edgeSel = gEdges.selectAll("line.edge").data(edgesToDraw, e => e.s+"__"+e.t+"__"+(e.cluster||"")+"__"+state.mode);
  edgeSel.exit().remove();
  const edgeEnter = edgeSel.enter().append("line").attr("class","edge").attr("stroke-linecap","round");
  edgeEnter.merge(edgeSel)
    .attr("x1", e => pos[e.s].x).attr("y1", e => pos[e.s].y)
    .attr("x2", e => pos[e.t].x).attr("y2", e => pos[e.t].y)
    .attr("stroke-width", e => wScale(e.w))
    .attr("stroke", e => {
      if(state.mode === "woi") return "#4C8FCB";
      if(e.status === "gained_in_RIF_LH+7") return "#2E7DB8";
      if(e.status === "lost_from_Fertile_LH+7") return "#C1443C";
      return "#B7BCC6";
    })
    .attr("opacity", e => state.mode === "rif" && e.status === "retained" ? 0.35 : 0.85);

  // --- NODES ---
  const nodeSel = gNodes.selectAll("g.node").data(nodesData, n => n.id);
  nodeSel.exit().remove();
  const nodeEnter = nodeSel.enter().append("g").attr("class","node").style("cursor","pointer")
    .on("click", (ev,n) => selectGene(n.id))
    .on("mouseenter", function(){ d3.select(this).select("circle.halo").attr("opacity",0.22); })
    .on("mouseleave", function(){ d3.select(this).select("circle.halo").attr("opacity",0); });

  nodeEnter.append("circle").attr("class","halo").attr("r", 44).attr("fill","#00539B").attr("opacity",0);
  nodeEnter.append("circle").attr("class","dualring");
  nodeEnter.append("circle").attr("class","core");
  nodeEnter.append("text").attr("class","label").attr("text-anchor","middle").attr("font-family","IBM Plex Mono, monospace");

  const merged = nodeEnter.merge(nodeSel);
  merged.attr("transform", n => `translate(${n.x},${n.y})`);
  merged.select("circle.halo").attr("transform", null);
  merged.select("circle.dualring")
    .attr("r", n => rScale(n.cent) + 6)
    .attr("fill","none")
    .attr("stroke", n => n.dual ? "#C9971F" : "none")
    .attr("stroke-width", 3);
  merged.select("circle.core")
    .attr("r", n => rScale(n.cent))
    .attr("fill", n => n.isolated ? "#B7BCC6" : (n.tf ? "#6E5AA6" : "#D9714E"))
    .attr("stroke", n => state.selectedGene===n.id ? "#001A44" : "#fff")
    .attr("stroke-width", n => state.selectedGene===n.id ? 4 : 1.8);
  merged.select("text.label")
    .attr("y", n => rScale(n.cent) + 18)
    .attr("font-size", 14)
    .attr("font-weight", 600)
    .attr("fill", "var(--ink)")
    .text(n => n.id);

  // legend swap
  document.getElementById("legend-woi").style.display = state.mode==="woi" ? "flex" : "none";
  document.getElementById("legend-rif").style.display = state.mode==="rif" ? "flex" : "none";
  document.getElementById("scrubber-wrap").style.display = state.mode==="woi" ? "flex" : "none";

  if(state.selectedGene) renderGenePanel(state.selectedGene);
}

// ===================== gene panel =====================
function centralityWord(v){
  if(v >= 0.4) return "very high — one of the network's main hubs";
  if(v >= 0.15) return "moderately high";
  if(v >= 0.05) return "low";
  return "very low — barely connected here";
}

function renderGenePanel(geneId){
  const d = GRN_DATA[state.comp];
  const node = d.nodes.find(n => n.id === geneId);
  const panel = document.getElementById("gene-panel");
  if(!node){
    panel.innerHTML = `<div class="empty-hint">Gene "${geneId}" isn't in ${state.comp}'s curated set for this preview.</div>`;
    return;
  }
  const trend = FERTILE_ORDER.map(c => (d.centrality[c] && d.centrality[c][geneId]) || 0);
  const rifVal = (d.centrality["RIF_LH+7"] && d.centrality["RIF_LH+7"][geneId]) || 0;
  const fertile7Val = (d.centrality["Fertile_LH+7"] && d.centrality["Fertile_LH+7"][geneId]) || 0;
  const currentVal = state.mode === "woi" ? trend[state.tpIndex] : Math.max(rifVal, fertile7Val);
  const maxV = Math.max(...trend, rifVal, 0.01);

  const sparkPts = trend.map((v,i) => `${i*40},${40 - (v/maxV)*36}`).join(" ");

  const rifDelta = rifVal - fertile7Val;
  const rifSentence = rifDelta > 0.02
    ? `In RIF, this gene becomes <strong>more</strong> central than it is in a normal LH+7 cycle — it's gaining influence when implantation is failing.`
    : rifDelta < -0.02
      ? `In RIF, this gene becomes <strong>less</strong> central than it is in a normal LH+7 cycle — it's losing influence when implantation is failing.`
      : `This gene's influence is about the same in RIF as in a normal LH+7 cycle.`;

  panel.innerHTML = `
    <div class="gname">${node.id}</div>
    <div>
      ${node.tf ? '<span class="tag tf">Transcription factor</span>' : '<span class="tag">Target-only</span>'}
      ${node.dual ? '<span class="tag dual">Dual-validated</span>' : ''}
    </div>

    <div class="explainer-box">
      <strong>What is "centrality"?</strong> It's a score for how important a gene is to the network at this moment — not how <em>active</em> the gene is, but how much it acts like a hub other genes depend on. Picture the network as a map of roads: a gene with high centrality is like a major intersection many roads pass through, so removing it would disrupt a lot of connections. A gene with low centrality is more like a quiet side street.
    </div>

    <div style="margin-top:14px;font-size:13px;">
      Right now, <strong class="mono">${node.id}</strong>'s centrality is <strong>${currentVal.toFixed(3)}</strong> — ${centralityWord(currentVal)}.
    </div>

    <div style="margin-top:14px;font-size:12px;color:var(--ink-soft);">How its centrality changes across the fertile cycle</div>
    <svg width="200" height="46" style="margin-top:6px;">
      <polyline points="${sparkPts}" fill="none" stroke="#00539B" stroke-width="2"/>
    </svg>
    <div style="font-size:11px;color:var(--ink-soft);display:flex;justify-content:space-between;width:200px;">
      <span>LH+3</span><span>LH+7 (WOI)</span><span>LH+11</span>
    </div>

    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line);font-size:12.5px;color:var(--ink-soft);">
      ${rifSentence}<br>
      <span style="font-size:11.5px;">(RIF centrality: <strong>${rifVal.toFixed(3)}</strong> · fertile LH+7 centrality: <strong>${fertile7Val.toFixed(3)}</strong>)</span>
    </div>
  `;
}

function selectGene(id){
  state.selectedGene = id;
  render();
}

// ===================== controls =====================
document.getElementById("compartment-seg").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if(!btn || btn.disabled) return;
  document.querySelectorAll("#compartment-seg button").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  state.comp = btn.dataset.comp;
  state.selectedGene = null;
  populateGeneList();
  render();
});

document.getElementById("mode-seg").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if(!btn) return;
  document.querySelectorAll("#mode-seg button").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  state.mode = btn.dataset.mode;
  render();
});

const slider = document.getElementById("tp-slider");
slider.addEventListener("input", () => {
  state.tpIndex = +slider.value;
  render();
});

let playTimer = null;
document.getElementById("play-btn").addEventListener("click", () => {
  const btn = document.getElementById("play-btn");
  if(state.playing){
    state.playing = false;
    clearInterval(playTimer);
    btn.textContent = "▶";
    return;
  }
  state.playing = true;
  btn.textContent = "⏸";
  playTimer = setInterval(() => {
    state.tpIndex = (state.tpIndex + 1) % 5;
    slider.value = state.tpIndex;
    render();
  }, 1100);
});

function populateGeneList(){
  const list = document.getElementById("gene-list");
  list.innerHTML = "";
  GRN_DATA[state.comp].nodes.forEach(n => {
    const opt = document.createElement("option");
    opt.value = n.id;
    list.appendChild(opt);
  });
}

document.getElementById("gene-search").addEventListener("input", e => {
  const val = e.target.value.trim().toUpperCase();
  const match = GRN_DATA[state.comp].nodes.find(n => n.id.toUpperCase() === val);
  if(match) selectGene(match.id);
});

// glossary popover
document.getElementById("glossary-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("glossary-pop").classList.toggle("open");
});
document.addEventListener("click", (e) => {
  const pop = document.getElementById("glossary-pop");
  if(!pop.contains(e.target) && e.target.id !== "glossary-btn"){
    pop.classList.remove("open");
  }
});

// theme toggle
document.getElementById("theme-toggle").addEventListener("click", (e) => {
  e.preventDefault();
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", isDark ? "light" : "dark");
  e.target.textContent = isDark ? "☾ Dark" : "☀ Light";
});

// accordion
document.querySelectorAll(".acc-head").forEach(h => {
  h.addEventListener("click", () => h.parentElement.classList.toggle("open"));
});

// copy citation
document.getElementById("copy-cite").addEventListener("click", () => {
  const text = document.getElementById("cite-text").innerText;
  navigator.clipboard && navigator.clipboard.writeText(text).catch(()=>{});
  const btn = document.getElementById("copy-cite");
  const orig = btn.textContent;
  btn.textContent = "Copied";
  setTimeout(()=>btn.textContent = orig, 1200);
});

// ===================== init =====================
measureCanvas();
populateGeneList();
render();

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    measureCanvas();
    layoutCache = {}; // force layouts recompute for new canvas size
    render();
  }, 250);
});
