# ASTRAEA · Endometrial Receptivity GRN Atlas

**Live site:** https://nandinigop8.github.io/dukehickeylab.io/

ASTRAEA (*Atlas of Single-cell Transcriptional Regulators And Elements of
Attachment*) maps how transcription factors switch genes on and off in the
human endometrium — across the fertile cycle (LH+3 → LH+11) and in
**recurrent implantation failure (RIF)** — and pairs every gene with its
published implantation literature.

Hickey Lab · Department of Biomedical Engineering · Duke University.
`demo_v1` is a review release, not for citation.

## Repository layout

| Path | What it is |
|---|---|
| `index.html` | Entry page: ASTRAEA logo + Desktop / iPad / Mobile tabs |
| `atlas.html`, `app.js`, `style.css`, `landing.css` | The atlas, and the entry-page styles |
| `assets/` | ASTRAEA logo + star mark (SVG) |
| `data/` | Site data: network, gene annotations, literature-supported links |
| `tools/` | Build scripts, validator, browser test, local server |
| `curation/` | Draft gene notes + review rules |
| `docs/` | Methods guide, design/functionality notes, progress log |
| `requirements.txt`, `environment.yml` | Python packages for the build scripts |

## Run locally

```bash
tools/serve_local.sh          # or: python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000/
```
Opening the HTML files by double-clicking will not work: browsers block the
data files over `file://`.

### How the platform tabs work

Each tab opens `atlas.html?ui=desktop|tablet|phone`, which sets the opening
panel widths (phone starts with both panels closed) and is then stripped from
the URL, so shared links and reloads keep whatever the visitor chose. The
"Controls" and "Details" buttons in the atlas top bar collapse either panel.

## Check before pushing

```bash
python3 tools/validate_site.py stromal        # data + site checks
node tools/tests/browser_smoke.js http://127.0.0.1:8000/   # in-browser checks
```
Checks that need files not kept in this repo are reported as **SKIP**, never
as a pass. Pushing to `main` republishes the site through GitHub Pages.

## Rebuilding the data (optional)

Needs the exported CellOracle/dynGENIE3 results from the lab's analysis
workspace, copied to `analysis_data/` (git-ignored, ~52 MB):

```bash
pip install -r requirements.txt
python3 tools/build_territory_graph.py stromal     # map data
python3 tools/build_gene_annotations.py            # literature (downloads ~100 MB once)
```

More detail, including what not to break: [`docs/HANDOFF.md`](docs/HANDOFF.md).
