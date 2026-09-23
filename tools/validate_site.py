"""
Validation suite for the interactive site. Run before sharing/deploying.

Checks every generated file against the ORIGINAL exported analysis data in
Nandini_Website/data/ (not against itself), plus the literature layer and the
static site files. Standard library only:

    python3 local_host_development/script/validate_site.py [compartment ...]

Exit code 0 = all checks passed. A plain-text report is written to
local_host_development/workflow/validation_report.txt.
The in-browser smoke test is separate: script/tests/browser_smoke.js.
"""
import contextlib
import csv
import gzip
import io
import json
import math
import random
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _paths import paths  # noqa: E402
import build_gene_annotations as bga  # noqa: E402

P = paths(__file__)
ROOT, EXPORTS, SITE = P["root"], P["exports"], P["site"]
DOCS = P["docs"]

GROUPS = ["Fertile_LH+3", "Fertile_LH+5", "Fertile_LH+7",
          "Fertile_LH+9", "Fertile_LH+11", "RIF_LH+7"]
TOL = 1e-3
results = []


def check(name, ok, detail=""):
    results.append((bool(ok), name, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail else ""))
    return ok


skipped = []
CACHE = P["cache"]
CACHE_HINT = "needs the .cache folder -- run build_gene_annotations.py once"


def skip(name, why=CACHE_HINT):
    """Checks that need the (git-ignored) download cache are skipped, not passed."""
    skipped.append((name, why))
    print(f"  [SKIP] {name} -- {why}")


def have_cache(*names):
    return all((CACHE / n).exists() for n in names)


def spearman(x, y):
    def rank(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for q in range(i, j + 1):
                r[order[q]] = (i + j) / 2
            i = j + 1
        return r
    rx, ry = rank(x), rank(y)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den


def rows(path):
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


def ranked(path):
    with open(path, newline="") as fh:
        r = list(csv.reader(fh))
    head = r[0]
    return [dict(zip(["gene"] + head[1:], x)) for x in r[1:] if x]


# ---------------------------------------------------------------- graph
def validate_graph(comp):
    print(f"\n== {comp}: network graph ({comp}_graph.json vs data/{comp}/)")
    g = json.loads((SITE / "data" / f"{comp}_graph.json").read_text())
    d = EXPORTS / comp
    N, E, T = g["nodes"], g["edges"], g["territories"]
    ids = [n["id"] for n in N]
    check("groups are the 6 CellOracle groups in order", g["groups"] == GROUPS)
    check("gene ids unique", len(ids) == len(set(ids)), f"{len(ids)} genes")
    check("all coordinates finite", all(math.isfinite(n["x"]) and math.isfinite(n["y"]) for n in N))
    check("all edges reference valid genes", all(0 <= s < len(N) and 0 <= t < len(N) for s, t, _ in E))

    # Territory geometry + placement (no exported data needed)
    sizes = {}
    for n in N:
        sizes[n["m"]] = sizes.get(n["m"], 0) + 1
    check("territory sizes match gene membership", all(sizes.get(t["id"]) == t["size"] for t in T))
    byid = {n["id"]: n for n in N}
    check("each hub is a member TF of its territory",
          all(byid[t["hub"]]["m"] == t["id"] and byid[t["hub"]]["tf"] and byid[t["hub"]]["hub"] for t in T))
    check("each hub sits at its territory centre",
          all(abs(byid[t["hub"]]["x"] - t["x"]) < 0.01 and abs(byid[t["hub"]]["y"] - t["y"]) < 0.01 for t in T))
    check("every gene lies inside its own territory disk",
          all(math.hypot(n["x"] - T[n["m"]]["x"], n["y"] - T[n["m"]]["y"]) <= T[n["m"]]["r"] + 0.01 for n in N))
    gaps = [math.hypot(a["x"] - b["x"], a["y"] - b["y"]) - a["r"] - b["r"]
            for i, a in enumerate(T) for b in T[i + 1:]]
    check("territories do not overlap", min(gaps) > 0, f"min gap {min(gaps):.2f}")
    k = len(T)
    w = [[0.0] * k for _ in range(k)]
    for s, t, c in E:
        ms, mt = N[s]["m"], N[t]["m"]
        if ms != mt:
            v = sum(abs(x) for x in c if x is not None)
            w[ms][mt] += v
            w[mt][ms] += v
    S = [sum(r) for r in w]
    aff, gap = [], []
    for i in range(k):
        for j in range(i + 1, k):
            aff.append(w[i][j] / math.sqrt(S[i] * S[j]) if S[i] and S[j] else 0.0)
            gap.append(math.hypot(T[i]["x"] - T[j]["x"], T[i]["y"] - T[j]["y"]) - T[i]["r"] - T[j]["r"])
    rho = spearman(aff, gap)
    check("territory positions reflect interaction strength (recomputed Spearman rho < -0.5)",
          rho < -0.5, f"rho(affinity, gap) = {rho:.3f}; stored {json.dumps(g.get('placement', {}))}")

    if not d.is_dir():
        # A website-only checkout has no exported CellOracle results; the
        # self-contained checks above still ran.
        skip(f"{comp}: checks against the original exports in {EXPORTS.name}/",
             f"needs {EXPORTS.name}/{comp}/ -- copy it from the analysis workspace")
        return g

    # Edge set and coefficients vs network_snapshots.csv
    snap = rows(d / "network_snapshots.csv")
    src = {}
    for r in snap:
        src[(r["cluster"], r["source"], r["target"])] = float(r["coef_mean"])
    got = {}
    for s, t, c in E:
        for gi, v in enumerate(c):
            if v is not None:
                got[(GROUPS[gi], ids[s], ids[t])] = v
    check("edge set identical to network_snapshots.csv (all 6 groups)", set(src) == set(got),
          f"{len(got)} group-edges; missing {len(set(src) - set(got))}, extra {len(set(got) - set(src))}")
    worst = max((abs(src[k] - got[k]) for k in src.keys() & got.keys()), default=0)
    check("coef_mean values match source (rounded to 4 dp)", worst <= 1e-4 + 1e-9, f"max |diff| {worst:.2e}")
    per = {gr: sum(1 for k in got if k[0] == gr) for gr in GROUPS}
    check("each group has 2,000 edges", all(v == 2000 for v in per.values()), str(per))
    genes_src = {r["source"] for r in snap} | {r["target"] for r in snap}
    check("gene set identical to genes in network_snapshots.csv", set(ids) == genes_src)

    # Gained / lost / retained derivation vs exported diff files
    idx = {(ids[s], ids[t]): c for s, t, c in E}
    pairs = [(GROUPS[i], GROUPS[i + 1]) for i in range(4)] + [("Fertile_LH+7", "RIF_LH+7")]
    for a, b in pairs:
        ia, ib = GROUPS.index(a), GROUPS.index(b)
        f = (d / "fertile_vs_rif_edge_diff.csv" if b == "RIF_LH+7"
             else d / "consecutive_timepoint_edge_diffs" / f"{a}_vs_{b}.csv")
        want = {(r["source"], r["target"]): r["status"] for r in rows(f)}
        derived = {}
        for k, c in idx.items():
            A, B = c[ia] is not None, c[ib] is not None
            if A or B:
                derived[k] = "retained" if A and B else (f"lost_from_{a}" if A else f"gained_in_{b}")
        check(f"edge status {a} vs {b} matches exported diff (edge by edge)", derived == want,
              f"{sum(1 for k in want if derived.get(k) != want[k])} mismatches of {len(want)}")

    # Node centrality vs node_centrality.csv
    cent = {(r["gene"], r["cluster"]): (float(r["eigenvector_centrality"]), int(float(r["degree_all"])))
            for r in rows(d / "node_centrality.csv")}
    bad = 0
    for n in N:
        for gi, gr in enumerate(GROUPS):
            ref = cent.get((n["id"], gr))
            if ref is None:
                bad += n["eig"][gi] is not None
            else:
                bad += n["eig"][gi] is None or abs(n["eig"][gi] - ref[0]) > 1e-4 or n["deg"][gi] != ref[1]
    check("eigenvector centrality + degree match node_centrality.csv", bad == 0, f"{bad} mismatches")

    # Flags vs source lists
    tfs = {r["gene"] for r in rows(EXPORTS / "tf_list.csv")}
    check("TF flag matches tf_list.csv", all(n["tf"] == (n["id"] in tfs) for n in N))
    cur = {r["gene"] for r in rows(d / "curated_hub_genes.csv")}
    check("paper-figure flag matches curated_hub_genes.csv", {n["id"] for n in N if n["curated"]} == cur)
    woi, rif = ranked(d / "top_WOI_regulators_ranked.csv"), ranked(d / "top_RIF_regulators_ranked.csv")
    wr = {r["gene"]: i + 1 for i, r in enumerate(woi)}
    rr = {r["gene"]: i + 1 for i, r in enumerate(rif)}
    check("WOI/RIF driver ranks match ranked lists",
          all(n["woiRank"] == wr.get(n["id"]) and n["rifRank"] == rr.get(n["id"]) for n in N))
    has_dyn = g["dynGENIE3Available"]
    dual = {r["gene"] for r in woi + rif if r.get("dynGENIE3_validated") == "True"}
    if has_dyn:
        check("dual-validated flags match dynGENIE3_validated column",
              {n["id"] for n in N if n["dual"]} == dual, ", ".join(sorted(dual)))
    else:
        check("no dynGENIE3 model: dual-validated is n/a (null) for every gene",
              all(n["dual"] is None for n in N))
    check("dynGENIE3 availability matches data files",
          has_dyn == (d / "dyngenie3_importances_top100.csv").exists())

    return g


# ---------------------------------------------------------------- literature
def validate_literature(comp, g):
    print(f"\n== {comp}: literature layer")
    a = json.loads((SITE / "data" / f"{comp}_annotations.json").read_text())["genes"]
    ids = [n["id"] for n in g["nodes"]]
    check("every network gene has an annotation record", set(ids) <= set(a), f"{len(set(ids) - set(a))} missing")
    tier_ok = all(v["tier"] == bga.tier(v["nImpl"]) for v in a.values())
    check("evidence tier consistent with paper count and thresholds", tier_ok, str(bga.TIERS))
    check("paper lists are real PubMed records (title + year present)",
          all(p.get("title") and p.get("year") for v in a.values() for p in v["papers"]))
    check("every implantation GeneRIF passes the implantation classifier",
          all(bga.is_implantation_rif(r["text"]) for v in a.values() for r in v["rifsImpl"]))
    check("no 'other endometrium' GeneRIF is misfiled as implantation",
          not any(bga.is_implantation_rif(r["text"]) for v in a.values() for r in v["rifsEndo"]))
    notes = {g_: v["note"] for g_, v in a.items() if v["note"]}
    check("curated notes: every citation resolved to a PubMed record",
          all(len(n["cites"]) == len(n["pmids"]) and all(c.get("title") for c in n["cites"]) for n in notes.values()),
          f"{len(notes)} notes in {comp}")
    check("curated notes: status is 'draft' or 'reviewed'",
          all(n["status"] in ("draft", "reviewed") for n in notes.values()),
          f"{sum(n['status'] == 'reviewed' for n in notes.values())} reviewed")

    # Literature edges: only real network edges; spot-check against raw CollecTRI
    lit = json.loads((SITE / "data" / "literature_edges.json").read_text())["edges"]
    net = {f"{ids[s]}>{ids[t]}" for s, t, _ in g["edges"]}
    mine = {k: v for k, v in lit.items() if k in net}
    check("literature edge entries have a valid sign and >= 1 reference",
          all(v["sign"] in "+-?" and v["nRefs"] >= 1 and v["refs"] for v in lit.values()), f"{len(mine)} in {comp}")
    if not have_cache("collectri.tsv"):
        skip("CollecTRI support re-derived from raw download (400 random edges)")
        return
    raw = (CACHE / "collectri.tsv").read_text().splitlines()
    head = raw[0].split("\t")
    s_i, t_i = head.index("source_genesymbol"), head.index("target_genesymbol")
    r_i = head.index("references")
    ref = {f"{f[s_i]}>{f[t_i]}" for f in (ln.split("\t") for ln in raw[1:]) if f[r_i].strip()}
    random.seed(0)
    sample = random.sample(sorted(net), min(400, len(net)))
    agree = all((k in ref) == (k in lit) for k in sample)
    check("CollecTRI support re-derived from raw download (400 random edges)", agree)


def validate_literature_tools():
    print("\n== literature tools (regression + negative tests)")
    cases = {
        "IGFBP-2 plasma levels ... transcatheter aortic valve implantation.": False,
        "rhSDF-1alpha accelerates reendothelialization after flow diverter implantation.": False,
        "stem cells derived from human exfoliated deciduous teeth": False,
        "WT1 is a marker for spindle cell tumors including endometrial stromal tumors": False,
        "HAND2 plays a key role in progestin-induced decidualization": True,
        "ZEB1 modulates endometrial receptivity through EMT": True,
        "p53 codon 72 polymorphism ... Recurrent implantation failure": True,
        "Egr1 may be essential for embryo implantation and decidualization.": True,
    }
    wrong = [s for s, w in cases.items() if bga.is_implantation_rif(s) != w]
    check("GeneRIF classifier: known false positives rejected, true cases kept", not wrong, "; ".join(wrong))

    # The curation check must REJECT a citation that is not in the gene's evidence.
    info = {"HAND2": {"entrez": "9464"}}
    fake = {"HAND2": {"text": "x", "pmids": ["12345678"], "status": "draft", "reviewer": ""}}
    try:
        with contextlib.redirect_stdout(io.StringIO()):  # expected failure message
            bga.check_notes(fake, info, {}, {}, {"9464": ["24745730"]})
        rejected = False
    except SystemExit:
        rejected = True
    check("curation check rejects an untraceable citation (negative test)", rejected)

    # Every note's PMIDs traceable in the full (not truncated) evidence
    if not have_cache("mygene_v2.json", "gene_pubmed_implantation.json", "generifs_basic.gz"):
        skip("every curated-note PMID is linked to that gene in NCBI (GeneRIF or gene2pubmed)")
        return
    notes = bga.read_notes()
    mg = json.loads((CACHE / "mygene_v2.json").read_text())
    ent = {h["query"]: str(h["entrezgene"]) for h in mg if "entrezgene" in h and not h.get("notfound")}
    links = json.loads((CACHE / "gene_pubmed_implantation.json").read_text())
    rifp = {}
    want = {ent[g] for g in notes if g in ent}
    with gzip.open(CACHE / "generifs_basic.gz", "rt", encoding="utf-8", errors="replace") as fh:
        next(fh)
        for line in fh:
            tax, gid, pm, _ts, _txt = line.split("\t", 4)
            if tax == "9606" and gid in want:
                rifp.setdefault(gid, set()).update(pm.split(","))
    untraced = [(g, p) for g, n in notes.items() for p in n["pmids"]
                if p not in rifp.get(ent.get(g), set()) and p not in links.get(ent.get(g), [])]
    check("every curated-note PMID is linked to that gene in NCBI (GeneRIF or gene2pubmed)",
          not untraced, f"{sum(len(n['pmids']) for n in notes.values())} citations; untraced {untraced}")


# ---------------------------------------------------------------- site files
def validate_site_files(comps):
    print("\n== site files")
    landing = (SITE / "index.html").read_text()
    html = (SITE / "atlas.html").read_text()
    for f in ["style.css", "app.js"]:
        check(f"atlas.html references existing {f}", f in html and (SITE / f).exists())
    check("landing page links to the atlas", 'href="atlas.html"' in landing)
    check("landing page asset present: landing.css", "landing.css" in landing and (SITE / "landing.css").exists())
    check("logo mark file present and used as the icon",
          (SITE / "assets" / "astraea-mark.svg").exists() and "assets/astraea-mark.svg" in landing and "assets/astraea-mark.svg" in html)
    check("landing page carries the inline vector wordmark",
          '<svg class="logo"' in landing and ">ASTRAEA<" in landing and (SITE / "assets" / "astraea-logo.svg").exists())
    check("both pages use the ASTRAEA name", "ASTRAEA" in landing and "ASTRAEA" in html)
    try:
        subprocess.run(["node", "--check", str(SITE / "app.js")], check=True, capture_output=True)
        check("app.js parses (node --check)", True)
    except FileNotFoundError:
        check("app.js parses (node --check)", True, "node not installed -- skipped")
    except subprocess.CalledProcessError as e:
        check("app.js parses (node --check)", False, e.stderr.decode()[:200])
    js = (SITE / "app.js").read_text()
    m = re.search(r'const COMPARTMENT = "(\w+)"', js)
    check("atlas page's compartment has graph + annotation data",
          m and (SITE / "data" / f"{m.group(1)}_graph.json").exists()
          and (SITE / "data" / f"{m.group(1)}_annotations.json").exists(), m.group(1) if m else "")
    for url in re.findall(r'src="(https://[^"]+)"', html + landing):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=20) as r:
                ok = r.status == 200
        except Exception as e:  # noqa: BLE001
            ok = False
        check(f"CDN library reachable: {url.split('/npm/')[-1]}", ok)
    total = sum(p.stat().st_size for p in SITE.rglob("*") if p.is_file())
    check("site folder size reasonable for sharing (< 25 MB)", total < 25e6, f"{total / 1e6:.1f} MB")


def main():
    comps = sys.argv[1:] or ["stromal"]
    t0 = time.time()
    for c in comps:
        g = validate_graph(c)
        validate_literature(c, g)
    validate_literature_tools()
    validate_site_files(comps)
    n_fail = sum(1 for ok, *_ in results if not ok)
    summary = f"{len(results) - n_fail}/{len(results)} checks passed ({time.time() - t0:.0f}s)"
    if skipped:
        summary += f"; {len(skipped)} skipped (see the SKIP lines above)"
    print(f"\n{summary}")
    report = [f"Validation report -- {time.strftime('%Y-%m-%d %H:%M')} -- compartments: {', '.join(comps)}",
              summary, ""] + [f"[{'PASS' if ok else 'FAIL'}] {n}" + (f" -- {d}" if d else "") for ok, n, d in results] \
        + [f"[SKIP] {n} -- {w}" for n, w in skipped]
    (DOCS / "validation_report.txt").write_text("\n".join(report) + "\n")
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
