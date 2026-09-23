/*
 * In-browser smoke test for the site (headless Chromium via Playwright).
 *
 * Needs Node + Playwright (not part of the site; install anywhere):
 *   npm i playwright && npx playwright install chromium
 * Then, with the site served (script/serve_local.sh, default port 8000):
 *   node script/tests/browser_smoke.js [baseURL] [screenshotDir]
 *
 * Exit code 0 = all checks passed.
 */
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8000/local_host_development/site/";
const OUT = process.argv[3] || null;
const results = [];
const check = (name, ok, detail = "") => {
  results.push(!!ok);
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? " -- " + detail : ""}`);
};

async function stats(p) {
  return p.$$eval("#stats div", (rows) => Object.fromEntries(rows.map((r) => {
    const [k, v] = r.querySelectorAll("span, b");
    return [k.textContent.trim(), Number(v.textContent.replace(/,/g, ""))];
  })));
}
const seg = (p, id, v) => p.click(`#${id} button[data-v="${v}"]`);
const shot = async (p, name) => { if (OUT) await p.screenshot({ path: `${OUT}/${name}.png` }); };

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [], failed = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("requestfailed", (r) => failed.push(r.url()));
  p.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

  console.log(`== browser smoke test: ${BASE}`);

  // Landing page first.
  await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  const landing = await p.evaluate(() => {
    const el = document.querySelector(".logo");           // inline SVG lockup
    const box = el && el.getBoundingClientRect();
    return { title: document.title, logoOk: !!box && box.width > 200 && box.height > 30,
             wordmark: !!el && /ASTRAEA/.test(el.textContent),
             entries: [...document.querySelectorAll(".entries a")].map((a) => a.getAttribute("href")),
             words: document.body.innerText.trim().split(/\s+/).filter(Boolean).length };
  });
  check("Landing page shows the ASTRAEA logo", landing.logoOk && landing.wordmark && /ASTRAEA/.test(landing.title), JSON.stringify(landing));
  check("Entry page offers desktop / iPad / mobile", landing.entries.join(",") === "atlas.html?ui=desktop,atlas.html?ui=tablet,atlas.html?ui=phone", landing.entries.join(" "));
  check("Entry page stays minimal (only the three labels)", landing.words <= 6, `${landing.words} words`);
  await shot(p, "00_landing");
  await p.click('.entries a[data-ui="desktop"]');
  await p.waitForLoadState("networkidle");
  await p.waitForSelector("#stats div", { timeout: 20000 });
  await p.waitForTimeout(800);

  // First visit: the "How to read this map" guide opens by itself.
  const helpOpen = await p.evaluate(() => document.getElementById("help").open);
  check("First visit opens the Reading Guide", helpOpen);
  const guide = await p.evaluate(() => ({ title: document.getElementById("help-title").textContent,
    cards: [...document.querySelectorAll("#help .gcard")].map((c) => c.querySelector(".badge").textContent + ":" + c.querySelector("h3").textContent),
    words: document.querySelector("#help .guide").innerText.split(/\s+/).length }));
  check("Guide is 'Reading Guide in 5 Steps' with 5 numbered cards", guide.title === "Reading Guide in 5 Steps" && guide.cards.length === 5 && guide.cards.every((c, i) => c.startsWith(String(i + 1))), guide.cards.join(" | "));
  check("Guide step cards are concise (< 90 words total)", guide.words < 90, `${guide.words} words`);
  await shot(p, "00_help");
  await p.click("#help-done"); await p.waitForTimeout(300);
  check("'Start exploring' closes the guide", !(await p.evaluate(() => document.getElementById("help").open)));
  await p.click("#help-open"); await p.waitForTimeout(200);
  const reopened = await p.evaluate(() => document.getElementById("help").open);
  await p.click("#help-close"); await p.waitForTimeout(200);
  check("Help button reopens the guide and × closes it", reopened && !(await p.evaluate(() => document.getElementById("help").open)));
  await p.reload({ waitUntil: "networkidle" }); await p.waitForSelector("#stats div"); await p.waitForTimeout(600);
  check("Guide does not reopen after it has been seen", !(await p.evaluate(() => document.getElementById("help").open)));
  await p.click('button[data-help="limits"]'); await p.waitForTimeout(200);
  const lim = await p.evaluate(() => document.getElementById("help").open && document.getElementById("help-limits").open);
  await p.click("#help-close"); await p.waitForTimeout(200);
  check("'Limits of this map' opens the guide at the limits section", lim);
  await seg(p, "colorby", "evidence");
  const tierCols = await p.$$eval("#legend-dots .sw", (s) => s.map((x) => getComputedStyle(x).backgroundColor));
  check("Evidence tiers use four distinct colours", new Set(tierCols).size === 4, tierCols.join(" "));
  await seg(p, "colorby", "territory");
  const hints = await p.$$eval("#mode-hint, #size-hint, #color-hint, #lit-hint", (els) => els.map((e) => e.textContent.trim().length));
  check("Every control shows a short explanation", hints.length === 4 && hints.every((n) => n > 5 && n < 60), JSON.stringify(hints));
  const badges = await p.$$eval(".panel.left > section > h2 .badge", (b) => b.map((x) => x.textContent));
  check("Left panel cards numbered 1-7 with the shared badge", badges.join("") === "1234567", badges.join(","));

  // Draggable sidebars: drag each bar, the map column follows, width persists.
  const widthOf = (sel) => p.$eval(sel, (e) => Math.round(e.getBoundingClientRect().width));
  const dragBar = async (side, dx) => {
    const b = await p.$(`.resizer[data-side="${side}"]`);
    const r = await b.boundingBox();
    await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await p.mouse.down();
    await p.mouse.move(r.x + r.width / 2 + dx, r.y + r.height / 2, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(300);
  };
  const l0 = await widthOf(".panel.left"), r0 = await widthOf(".panel.right"), s0 = await widthOf("#stage");
  await dragBar("left", 80); await dragBar("right", -60);
  const l1 = await widthOf(".panel.left"), r1 = await widthOf(".panel.right"), s1 = await widthOf("#stage");
  check("Dragging the left bar widens the left panel", Math.abs(l1 - l0 - 80) <= 3, `${l0} -> ${l1}`);
  check("Dragging the right bar widens the right panel", Math.abs(r1 - r0 - 60) <= 3, `${r0} -> ${r1}`);
  const canvasW = await p.evaluate(() => Math.round(grnDebug.renderer.getCanvases().nodes.getBoundingClientRect().width));
  check("Map shrinks to fit and the graph canvas follows", Math.abs(s0 - s1 - 140) <= 4 && Math.abs(canvasW - s1) <= 2, `stage ${s0} -> ${s1}, canvas ${canvasW}`);
  await p.reload({ waitUntil: "networkidle" }); await p.waitForSelector("#stats div"); await p.waitForTimeout(400);
  check("Panel widths are remembered after reload", Math.abs((await widthOf(".panel.left")) - l1) <= 2 && Math.abs((await widthOf(".panel.right")) - r1) <= 2);
  await p.dblclick('.resizer[data-side="left"]'); await p.dblclick('.resizer[data-side="right"]'); await p.waitForTimeout(300);
  check("Double-click resets panel widths", Math.abs((await widthOf(".panel.left")) - l0) <= 2 && Math.abs((await widthOf(".panel.right")) - r0) <= 2);
  await shot(p, "01_overview");

  let s = await stats(p);
  const both = (x) => x["Links in both"], gain = (x) => x["New in RIF"], lost = (x) => x["Missing in RIF"];
  check("Both: in both / new / missing = 1,425 / 575 / 575", both(s) === 1425 && gain(s) === 575 && lost(s) === 575, JSON.stringify(s));
  await seg(p, "mode", "fertile"); s = await stats(p);
  check("Fertile network = 2,000 links (in both + missing in RIF)", both(s) + lost(s) === 2000 && gain(s) === 0);
  await seg(p, "mode", "rif"); s = await stats(p);
  check("RIF network = 2,000 links (in both + new in RIF)", both(s) + gain(s) === 2000 && lost(s) === 0);
  await seg(p, "mode", "both");

  // Literature filters
  await seg(p, "lit", "edges"); s = await stats(p);
  const vis = both(s) + gain(s) + lost(s);
  check("'Known links' filter shows only CollecTRI-supported links", vis > 0 && s["Known links"] === vis, `${vis} links`);
  await p.waitForTimeout(400); await shot(p, "02_lit_edges");
  await seg(p, "lit", "genes"); s = await stats(p);
  check("'Known genes' filter narrows the network", both(s) + gain(s) + lost(s) < 2575 && both(s) + gain(s) + lost(s) > 0, JSON.stringify(s));
  await seg(p, "lit", "off");

  // Evidence colouring + legend
  await seg(p, "colorby", "evidence");
  const legendEv = await p.$$eval("#legend-dots li", (els) => els.length);
  check("Literature colouring shows its 4-tier legend", legendEv === 4);
  await p.waitForTimeout(400); await shot(p, "03_evidence_colour");
  await seg(p, "colorby", "territory");

  // Right panel lists
  const known = await p.$$eval(".detail-section h2", (hs) => hs.map((h) => h.textContent));
  check("Territory panel lists known regulators and novel candidates",
    known.some((t) => t.includes("Known implantation regulators")) && known.some((t) => t.includes("Novel candidates")));
  const knownGenes = await p.$$eval(".detail-section", (secs) => {
    const s = secs.find((x) => /Known implantation regulators/.test(x.querySelector("h2")?.textContent || ""));
    return s ? s.querySelectorAll(".edge-list li").length : 0;
  });
  check("Known-regulator list is populated", knownGenes > 0, `${knownGenes} genes`);

  // Gene with a curated note
  await p.fill("#search", "HAND2"); await p.press("#search", "Enter"); await p.waitForTimeout(900);
  const hand2 = await p.$eval("#detail", (d) => d.innerText);
  check("HAND2: curated note shown with draft status", /decidualization/i.test(hand2) && /Draft/.test(hand2));
  const secs = await p.$$eval("#detail .gsec h4", (hs) => hs.map((h) => h.textContent.trim()));
  check("Gene panel sections A-D in order: Name, Function in implantation, General function, Literature",
    secs.length === 4 && /^AName/.test(secs[0]) && /^B.*implantation/i.test(secs[1]) && /^C.*general function/i.test(secs[2]) && /^D.*literature/i.test(secs[3]), JSON.stringify(secs));
  const rightBadges = await p.$$eval("#detail .badge", (b) => b.map((x) => x.textContent).join(""));
  check("Gene view cards lettered A-F with the shared badge", rightBadges === "ABCDEF", rightBadges);
  const sameStyle = await p.evaluate(() => {
    const a = getComputedStyle(document.querySelector(".panel.left .badge")), b = getComputedStyle(document.querySelector("#detail .badge"));
    return a.backgroundColor === b.backgroundColor && a.width === b.width && a.borderRadius === b.borderRadius;
  });
  check("Badges styled identically in left and right panels", sameStyle);
  check("HAND2: alternative names shown (e.g. dHand)", /Also known as.*dHand/.test(hand2));
  const cites = await p.$$eval(".gsec .note-src a", (as) => as.map((a) => a.href));
  check("HAND2: note citations link to PubMed", cites.length >= 1 && cites.every((h) => h.startsWith("https://pubmed.ncbi.nlm.nih.gov/")), cites.join(" "));
  await p.click('#detail .gsec[data-sec="D"] > summary'); await p.waitForTimeout(200);
  const citeTexts = await p.$$eval('#detail a[href^="https://pubmed"]', (as) => as.map((a) => a.textContent.trim()));
  check("Citations are PMID hyperlinks only", citeTexts.length > 0 && citeTexts.every((x) => /^PMID \d+$/.test(x)), citeTexts.join(", "));
  const hasRefList = await p.$eval("#detail", (d) => /Sources of the summary/.test(d.innerText) || !!d.querySelector(".cites"));
  check("No written-out reference list in the gene panel", !hasRefList);
  await p.click('#detail .gsec[data-sec="D"] > summary');
  await shot(p, "04_gene_HAND2");

  // Gene without implantation literature -> novel candidate
  await p.fill("#search", "C11orf96"); await p.press("#search", "Enter"); await p.waitForTimeout(700);
  const c11 = await p.$eval("#detail", (d) => d.innerText);
  check("C11orf96: shown as novel candidate with no implantation literature", /Novel candidate/.test(c11) && /None found/i.test(c11));

  // Tcell-style n/a is covered by the Python validator; here: dual-validated tag for ZEB1
  await p.fill("#search", "ZEB1"); await p.press("#search", "Enter"); await p.waitForTimeout(700);
  const zeb = await p.$eval("#detail", (d) => d.innerText);
  check("ZEB1: 'Confirmed by 2 methods' tag shown", /Confirmed by 2 methods/.test(zeb));
  const litBadges = await p.$$eval("#detail .edge-list .lit", (b) => b.length);
  check("ZEB1: at least one edge carries a CollecTRI 'lit' badge", litBadges > 0, `${litBadges} badges`);
  await shot(p, "05_gene_ZEB1");

  // Escape clears selection
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  const st = await p.evaluate(() => ({ s: grnDebug.state.selected, t: grnDebug.state.territory }));
  check("Escape clears selection", st.s === null && st.t === null);
  // Rendering is asynchronous (and slow under software GL): poll until the
  // frame after Escape has been drawn, fail only if the ring never clears.
  await p.waitForFunction(() => {
    const c = grnDebug.renderer.getCanvases().selection;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
    return true;
  }, null, { timeout: 3000 }).catch(() => {});
  const ringPixels = await p.evaluate(() => {
    const cs = grnDebug.renderer.getCanvases();
    const out = {};
    for (const name of ["hovers", "selection"]) {
      const c = cs[name];
      if (!c) { out[name] = -1; continue; }
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
      out[name] = n;
    }
    return out;
  });
  check("Escape leaves no stale selection ring (regression)", ringPixels.hovers === 0 && ringPixels.selection === 0,
    JSON.stringify(ringPixels) + " painted pixels");

  // Panel toggles (used by the iPad / mobile entries)
  const panelState = async () => p.evaluate(() => ({
    left: !document.body.classList.contains("hide-left"),
    right: !document.body.classList.contains("hide-right"),
    stage: Math.round(document.getElementById("stage").getBoundingClientRect().width),
  }));
  const before = await panelState();
  await p.click("#toggle-left"); await p.waitForTimeout(350);
  const hidden = await panelState();
  await p.click("#toggle-left"); await p.waitForTimeout(350);
  const back = await panelState();
  check("Controls button hides and restores the left panel",
    before.left && !hidden.left && back.left && hidden.stage > before.stage && back.stage === before.stage,
    JSON.stringify({ before, hidden, back }));
  await p.goto(BASE + "atlas.html?ui=phone", { waitUntil: "networkidle" });
  // With the phone entry both panels start closed, so wait for the map itself.
  await p.waitForFunction(() => window.grnDebug && grnDebug.graph.order > 0);
  await p.waitForTimeout(500);
  const phone = await panelState();
  check("Mobile entry opens the map with both panels closed", !phone.left && !phone.right, JSON.stringify(phone));
  await p.goto(BASE + "atlas.html?ui=desktop", { waitUntil: "networkidle" });
  await p.waitForSelector("#stats div"); await p.waitForTimeout(500);
  await p.evaluate(() => { document.getElementById("toggle-left").click(); document.getElementById("toggle-left").click(); });

  // Territory click
  await p.click('.territories li[data-t="0"]'); await p.waitForTimeout(900);
  const terr = await p.$eval("#detail", (d) => d.innerText);
  check("Territory detail opens (roads + importance changes)", /roads to other territories/i.test(terr) && /importance changes most/i.test(terr));
  await shot(p, "06_territory");

  // Phone width: no horizontal page scroll
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(500);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("Phone width (390px): no horizontal scroll", overflow <= 1, `overflow ${overflow}px`);
  await shot(p, "07_phone");

  check("No JavaScript errors", errors.length === 0, errors.join(" | "));
  check("No failed network requests", failed.length === 0, failed.join(" | "));

  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} browser checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
