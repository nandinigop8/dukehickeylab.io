# Endometrial GRN Atlas — Hickey Lab

An interactive website visualizing the Hickey Lab's gene-regulatory-network (GRN)
research on the human endometrium: how the regulatory wiring between genes shifts
across the window of implantation (WOI) in fertile cycles, and how it differs in
recurrent implantation failure (RIF).

**Status: preview build.** Stromal and Epithelial are fully wired with real data.
Tcell, uNK, and ActivatedNK are stubbed in the UI (shown disabled) and need their
data added the same way — see "Adding the remaining compartments" below.

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | Page structure and content — hero, study-design overview, the interactive explorer, methods comparison, findings, data dictionary, citation block, limitations |
| `styles.css` | All visual styling — colors, type, layout, light/dark mode |
| `data.js` | The actual network data (curated genes, edges, centrality, RIF diffs) for Stromal and Epithelial, extracted from the lab's exported CSVs |
| `app.js` | All interactivity — force-directed layout, timepoint scrubber, WOI-vs-RIF toggle, gene search/click panel, glossary popover, theme toggle |

No build step, no dependencies to install. The only external resource is
[D3.js](https://d3js.org/) (v7), loaded from a CDN in `index.html`, plus Google
Fonts (Source Serif 4, IBM Plex Sans, IBM Plex Mono).

## Running it locally

Because `app.js` loads `data.js` as a separate `<script>` file, opening
`index.html` directly from disk (`file://`) will work in most browsers, but if
your browser blocks local script loading, run a tiny local server from this
folder instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying to GitHub Pages

1. Push this folder's contents to a repo (or a `docs/` folder, or a `gh-pages` branch).
2. In the repo's **Settings → Pages**, set the source to that folder/branch.
3. GitHub will publish it at `https://<org-or-user>.github.io/<repo-name>/`.

No server-side code is needed — it's a fully static site.

## Where the data came from

`data.js` was generated from the lab's `Nandini_Website` handoff package
(`data/<compartment>/*.csv`), specifically:

- `curated_hub_genes.csv` — which ~15–26 genes to show per compartment
- `network_snapshots.csv` — the full CellOracle edge list per group, filtered down
  to edges where both genes are in the curated set
- `node_centrality.csv` — eigenvector centrality per gene per group (drives node size)
- `fertile_vs_rif_edge_diff.csv` — which edges are gained/lost/retained in RIF
- `top_WOI_regulators_ranked.csv` — which genes count as "dual-validated"

Full methodology, every column's meaning, and all caveats are documented in the
package's own `METHODS_AND_DATA_GUIDE.md` — several of its warnings (pseudotime
reliability by compartment, pooled vs. per-subject RIF comparisons, "not causal
validation") are already reflected in the site's Limitations accordion and
should stay in sync if that guide is later revised.

## Adding the remaining compartments (Tcell, uNK, ActivatedNK)

1. Re-run the same extraction against `data/<compartment>/curated_hub_genes.csv`,
   `network_snapshots.csv`, `node_centrality.csv`, `fertile_vs_rif_edge_diff.csv`,
   and `top_WOI_regulators_ranked.csv` for each compartment, in the same shape
   already used for `stromal`/`epithelial` in `data.js`:
   ```json
   {
     "clusters": [...],
     "nodes": [{ "id": "GENE", "tf": true, "dual": false }, ...],
     "edges": [{ "s": "SRC", "t": "TGT", "cluster": "Fertile_LH+7", "w": 0.42, "sign": 1 }, ...],
     "centrality": { "Fertile_LH+7": { "GENE": 0.31, ... }, ... },
     "rif_diff": { "SRC__TGT": "gained_in_RIF_LH+7", ... }
   }
   ```
2. Add the new key(s) to the top-level object in `data.js`.
3. In `index.html`, remove the `disabled` attribute from that compartment's
   button in `#compartment-seg` and drop its `title="..."` tooltip.
4. Tcell has no `dyngenie3_*` files upstream (its pseudotime failed validation) —
   that's expected, not a missing-data bug; don't backfill a dual-validated flag
   for it.
5. Once all 5 compartments are wired, consider replacing the inlined `data.js`
   with per-compartment `data/<compartment>.json` files fetched on demand — the
   full uncapped network data (not just the curated genes) is much larger
   (~30MB per compartment for `dyngenie3_importances_full.csv` alone) and
   shouldn't all load on page open. See the package's own guide, §4.8, for the
   recommended `_top100.csv` / `_full.csv` loading strategy.

## Before this goes live

- [ ] Replace the placeholder citation block in the Data & Citation section
      (subject counts, DOI/repo URL, manuscript reference)
- [ ] Point the footer's GitHub repo / Lab homepage / Contact links at real URLs
- [ ] Wire in the remaining 3 compartments (above)
- [ ] Decide whether to expose the full uncapped network (beyond the curated
      15–26 genes) as an "expand" option, as the source guide suggests

## License / attribution

Add the lab's preferred license and citation here before publishing.
