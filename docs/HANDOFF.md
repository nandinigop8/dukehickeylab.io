# Handoff: Endometrial GRN Explorer (demo_v1 → next)

For **Nandini**. This gets you from "received the project" to "running and
changing it" in about 15 minutes. For the science and data dictionary see
[`METHODS_AND_DATA_GUIDE.md`](METHODS_AND_DATA_GUIDE.md); for every design
decision and bug fixed so far see
[`docs/progress.txt`](docs/progress.txt).

- **Live site:** https://nandinigop8.github.io/dukehickeylab.io/
- **Repo:** https://github.com/nandinigop8/dukehickeylab.io
- **Analysis workspace (same toolchain):** https://github.com/auggiepoysungnoen/Endometrial_Receptivity_GRN_Demo_V1

---

## 1. Get set up

**Code** (from GitHub; ask Auggie to add you as a collaborator):
```bash
git clone https://github.com/nandinigop8/dukehickeylab.io.git
cd dukehickeylab.io
```

**Data** (not on GitHub: unpublished and large). Copy the lab's exported
results (~52 MB) into the clone as `./analysis_data/`. Optional:
`./figures/` (the static paper figures, for reference only).

**Python** (only needed to rebuild data; the site itself is plain HTML/JS).
With these pinned versions, rebuilding `stromal_graph.json` reproduces the
committed file byte for byte:
```bash
pip install -r requirements.txt           # or: conda env create -f environment.yml
```

> If you received the whole folder instead of cloning: it contains a `.git/`
> configured for a deploy key on another machine. Run
> `git config --unset core.sshCommand` and set up your own GitHub access.

## 2. Run it locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1     # from the repo root (any OS)
# open http://127.0.0.1:8000/   (entry page)
```
(`tools/serve_local.sh` does the same on Mac/Linux.)
Opening `index.html` by double-click will **not** work: browsers block the
data files over `file://`.

## 3. How it fits together

```
data/<compartment>/*.csv            exported CellOracle / dynGENIE3 results (input, not in git)
        │
        ├─ script/build_territory_graph.py  →  site/data/<comp>_graph.json
        │     union of the 6 networks, Leiden territories, hubs, fixed layout
        │     (positions reflect how strongly territories interact)
        │
        └─ script/build_gene_annotations.py →  site/data/<comp>_annotations.json
              NCBI summaries/aliases, GeneRIFs,       + literature_edges.json
              implantation papers, CollecTRI links,
              + curation/implantation_gene_notes.csv (36 draft notes)
                                                    │
site/index.html + app.js + style.css  ◄─────────────┘   (sigma.js + graphology from CDN)
```
All paths above are under `local_host_development/`.

| File | What it is |
|---|---|
| `site/app.js` | The whole app: loading, map rendering, territories/roads overlay, filters, panels, reading guide, resizable sidebars |
| `site/index.html` | Entry page: ASTRAEA logo + Desktop / iPad / Mobile tabs |
| `site/atlas.html`, `style.css`, `landing.css` | The atlas itself, and the entry-page styles |
| `site/assets/*.svg` | ASTRAEA logo and star mark |
| `script/_paths.py` | Finds site/data/cache in either layout (workspace or website repo) |
| `script/build_territory_graph.py` | Build map data for one compartment |
| `script/build_gene_annotations.py` | Build literature data for all compartments (downloads ~100 MB on first run into `.cache/`, ~10 min) |
| `script/validate_site.py` | 44 data checks against the original exports |
| `script/tests/browser_smoke.js` | 40 in-browser checks (needs Node + Playwright) |
| `curation/` | Draft gene notes + review rules |
| `workflow/` | Design, functionality, progress log, latest validation report |
| `.github/workflows/pages.yml` | Publishes `site/` to GitHub Pages on every push to `main` |

## 4. Common tasks

**Rebuild after data changes**
```bash
python3 tools/build_territory_graph.py stromal
python3 tools/build_gene_annotations.py
```

**Validate (do this before every push)**
```bash
python3 tools/validate_site.py stromal
#   expect 44/44; on a fresh clone 42/42 + 2 SKIP until build_gene_annotations.py
#   has been run once (those 2 checks re-read the git-ignored download cache)
# browser test (one-time: npm i playwright && npx playwright install chromium)
node tools/tests/browser_smoke.js http://127.0.0.1:8000/
```

**Edit or review a gene note**: edit `curation/implantation_gene_notes.csv`
(rules in `curation/README.txt`; every PMID must be linked to that gene in NCBI,
or the build stops), then rerun `build_gene_annotations.py`.

**Deploy**: commit and push to `main`; the Pages workflow republishes in ~1 min.

## 5. What's next (open to-dos)

1. **"Across the cycle" view** (LH+3 → LH+11): the tab is stubbed as "soon".
   All 5 timepoints are already in `stromal_graph.json` (`edges[i][2]` holds
   coef per group, order in `groups`). Plan: slider over the same fixed layout;
   flash links gained/lost between steps. Never place RIF on this timeline.
2. **Other compartments** (epithelial, tcell, unk, activatednk): run
   `build_territory_graph.py <comp>` and `build_gene_annotations.py`, then add a
   compartment switcher (`COMPARTMENT` is hard-coded to `"stromal"` in
   `app.js`). Tcell has no dynGENIE3 model; the UI already shows
   "2nd method not available". The other compartments' annotation files are
   git-ignored for demo_v1; remove those lines from `.gitignore` when they go live.
3. **Lab review of the 36 draft notes** (all `status=draft`).
4. Nice to have: bundle sigma/graphology locally for offline use; update the
   Pages workflow actions (GitHub shows a harmless Node 20 deprecation warning).

## 6. Things not to break

- **Scientific guardrails** (METHODS_AND_DATA_GUIDE §6; also in the reading
  guide's "Limits"): links are predictions, not causal; RIF only at LH+7;
  gained/lost is pooled, not per subject; territories are algorithmic;
  don't compare network size across compartments.
- **Consistent vocabulary** in the UI: gene = dot, link = line, territory,
  road, importance; "in both / new in RIF / missing in RIF". Citations are
  PMID links only.
- **One card style**: every panel block is a card with the filled purple
  badge (numbers on the left, letters on the right).
- Overlay canvases use CPU-backed contexts (`willReadFrequently`) on purpose:
  some GPU backends otherwise leave a stale selection ring (see progress log).
