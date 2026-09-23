# ASTRAEA ATLAS

**[Open the live ASTRAEA ATLAS](https://nandinigop8.github.io/dukehickeylab.io/)**

ASTRAEA ATLAS is an interactive gene regulatory network atlas of human
endometrial receptivity. The current release compares fertile and recurrent
implantation failure (RIF) stromal networks at LH+7 and connects genes and
regulatory links to their available PubMed evidence.

Hickey Lab, Department of Biomedical Engineering, Duke University.

## What the atlas shows

- Predicted transcription factor to target relationships from CellOracle
- Fertile links, RIF links, and links shared by both conditions
- Gene centrality within the fertile LH+7 network
- Independent regulator support from dynGENIE3 along fertile pseudotime
- Complete stored PubMed records for each gene and every stored PMID for
  literature-supported regulatory links

CellOracle and dynGENIE3 provide complementary evidence. CellOracle identifies
condition and timepoint-specific regulatory links; dynGENIE3 independently
ranks regulators along fertile pseudotime. Agreement between the two methods
raises confidence, but does not establish causality.

## How candidates are selected

1. Start with transcription factors that occupy central positions in the
   fertile LH+7 network.
2. Prioritize regulators whose network position or links differ in RIF.
3. Raise confidence when CellOracle and dynGENIE3 support the same regulator.
4. Use PubMed and CollecTRI evidence to distinguish established biology from
   candidates that require experimental validation.

## Important limitations

The displayed links are computational predictions, not proven cause and
effect. Network centrality describes position in the inferred network, not
gene expression. RIF samples are available at LH+7, and inferred candidates
require independent experimental validation.

## Repository layout

| Path | Contents |
|---|---|
| `index.html` | Responsive entry page for Desktop, iPad, and Mobile |
| `atlas.html`, `app.js`, `style.css`, `landing.css` | Interactive atlas and presentation styles |
| `data/` | Network, gene annotation, and literature-link data used by the site |
| `tools/` | Data builders, validation suite, browser tests, and local server |
| `curation/` | Curated implantation summaries and review guidance |
| `docs/` | Methods, functionality, progress, and validation documentation |
| `requirements.txt`, `environment.yml` | Reproducible build dependencies |

## Run locally

```bash
tools/serve_local.sh
# Open http://127.0.0.1:8000/
```

The site must be served over HTTP because browsers block its data requests
when the HTML files are opened directly with `file://`.

## Validate

```bash
python3 tools/validate_site.py stromal
node tools/tests/browser_smoke.js http://127.0.0.1:8000/
```

The latest complete development run passed 61 of 61 data and site checks and
55 of 55 browser checks. Checks requiring analysis files that are not stored
in this publication repository are reported as skipped.

## Rebuild the data

Rebuilding requires the exported CellOracle and dynGENIE3 results from the
analysis workspace in the git-ignored `analysis_data/` directory.

```bash
pip install -r requirements.txt
python3 tools/build_territory_graph.py stromal
python3 tools/build_gene_annotations.py
```

See [`docs/METHODS_AND_DATA_GUIDE.md`](docs/METHODS_AND_DATA_GUIDE.md) for the
full methodology and data dictionary.
