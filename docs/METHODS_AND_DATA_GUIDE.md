# Methods and data guide — interactive GRN website

Written for whoever is building the interactive website (an audience that
knows web development, not necessarily reproductive biology or GRN
inference) so the site can be built without needing to reverse-engineer the
analysis code or ask the lab basic "what does this column mean" questions.
For deeper detail than this document covers, the full pipeline and its
documentation live one level up, in `docs/` (see "Where to go for more" at
the end).

## 1. What this project is

This is a study of the **gene-regulatory architecture of the human
endometrium** — which transcription factors (TFs) control which genes, and
how that control network rewires (a) across the window of implantation
(WOI) in fertile menstrual cycles, and (b) in **recurrent implantation
failure (RIF)** compared to fertile cycles at the same point in the cycle.

The data is single-cell RNA-sequencing (scRNA-seq) from human endometrial
biopsies (Cao et al.; 28 subjects, ~209,000 cells after QC), split into:

- **Fertile** subjects, one biopsy each, at one of five timepoints relative
  to the luteinizing hormone (LH) surge: LH+3, LH+5, LH+7, LH+9, LH+11. LH+7
  is the canonical "window of implantation" — the few-day period each cycle
  when the endometrium is receptive to an embryo.
- **RIF** (recurrent implantation failure) subjects, all biopsied at LH+7
  (the same timepoint as the fertile WOI), so this is the one point in the
  cycle where fertile and RIF can be directly compared without timepoint
  being a confound.

Every gene has a regulatory network fit **separately per compartment**
(cell type) **and per group** (5 Fertile timepoints + RIF-LH+7 = 6 groups),
so "the network" is really 6 networks per compartment, deliberately not
merged, because the whole point is watching how the network changes across
time and between conditions.

**Five compartments**, each analyzed independently (their absolute cell
counts differ ~4x, so they are never compared to each other on absolute
network size — only within-compartment, across time/condition):

| Compartment | Cells | Role |
|---|---|---|
| Epithelial | 48,655 | Secretory-transformation lineage; sparser, hub-centered network |
| Stromal | 85,641 | Decidualization; dense TF-cascade network |
| Tcell | 26,053 | Immune; CellOracle-only (see §3) |
| uNK (uterine NK) | 25,864 | Immune |
| ActivatedNK | 22,570 | Immune |

## 2. Two independent network-inference methods

The project uses **two different, complementary methods** to infer
regulatory networks from the same underlying expression data. They are not
two views of one computation — they make different modeling choices, and
agreement between them is itself a result (see §2.3). Every figure/data file
in this package is clearly one or the other; don't merge them into a single
"the network" without keeping that label.

### 2.1 CellOracle — discrete, per-group networks

**This is the network in `figures/05_network_maps/*_network_*.png` (panels
A and B) and the `network_snapshots.*` / edge-diff files in `data/`.**

- Starts from a **base GRN**: a genome-derived, motif-scan-based prior
  (which TFs *could plausibly* bind which gene's promoter, from sequence
  alone — not from this dataset's expression). This constrains which
  TF→target edges are even candidates before any expression data is used.
- For each compartment, fits **one model per group** (6 groups: 5 Fertile
  timepoints + RIF-LH+7) via **bagged ridge regression** (20 bootstrap
  iterations) of each target gene's expression on its candidate regulators'
  expression, using only cells from that specific group.
- Each group's fitted network is pruned to its **top 2,000 edges** (by
  absolute regression coefficient, p < 0.001).
- Result: 6 **discrete snapshots** per compartment — literally 6 separate
  networks, one per timepoint/condition, directly comparable to each other
  edge-by-edge (same candidate-edge universe, from the same base GRN).
- **Directed, signed edges**: `coef_mean` can be positive (activating) or
  negative (repressing); `coef_abs`/`-logp` are the confidence/strength used
  for edge width in the figures.

### 2.2 dynGENIE3 — continuous, pseudotime-based

**This is the network in `figures/05_network_maps/dyngenie3_network_*.png`
(panel C) and the `dyngenie3_importances_*.csv` files in `data/`.**

- Not constrained by the base GRN — it considers a **much wider** candidate
  regulator-target space (every detected TF against every modeled target
  gene), which is why its raw output is ~1.5 million rows per compartment
  vs. CellOracle's 2,000-per-group.
- Doesn't use discrete groups at all. Fertile cells are ordered along a
  **pseudotime** trajectory (a 1-D "biological clock" estimated from
  expression, validated against the known real timepoints — see
  `docs/METHODS.txt` for how), binned into 150 equal-occupancy bins, and a
  **random-forest regression** (500 trees per target gene, not a linear
  model like CellOracle) predicts each target's expression trajectory from
  its candidate regulators' expression across those bins.
- Output is a single **continuous-dynamics** importance score per
  regulator→target pair — not tied to any one timepoint, more like "how
  much does this regulator matter across the whole fertile trajectory."
- **RIF is not represented here at all** — dynGENIE3 only ever sees Fertile
  cells (pseudotime is a Fertile-only concept in this analysis; RIF has only
  one timepoint, so it can't be pseudotime-ordered). Any RIF-vs-Fertile
  comparison must come from CellOracle (§2.1).
- **Tcell has no dynGENIE3 model**: its pseudotime failed the pre-registered
  validation gate (Spearman rho ≥ 0.3; Tcell's actual rho = 0.23), so it was
  excluded by design. `data/tcell/` has no `dyngenie3_importances_*` files —
  don't build a "combined-effect" panel for Tcell.

### 2.3 Why both, and what "dual-validated" means

The two methods differ in expression averaging (per-cell vs. per-pseudotime-bin
mean), model class (linear bagged ridge vs. nonlinear random forest), base-GRN
constraint (yes vs. no), and time representation (discrete group vs.
continuous trajectory) — so agreement between them is real evidence, and
disagreement doesn't invalidate either one; it's reported, not hidden.

A regulator is called **dual-validated** if it's both (a) among CellOracle's
top centrality-shift ("driver") genes, and (b) has above-median aggregate
dynGENIE3 importance (summed across all its target edges) within its
compartment. This is a genuinely meaningful "more confident" label — use it
if your interactive site wants to default-highlight the most robust
regulators. Currently:

- **Epithelial**: ID1 (the only one)
- **Stromal**: RORA, ZEB1
- **uNK / ActivatedNK**: see each compartment's `top_WOI_regulators_ranked.csv`
  / `top_RIF_regulators_ranked.csv` (`dynGENIE3_validated` column)
- **Tcell**: cannot be dual-validated by construction (no dynGENIE3 model) —
  if you show a "dual-validated" flag anywhere, Tcell genes must always read
  false/not-applicable, never a false negative that looks like "checked and
  failed."

## 3. How the static figure picks which genes/edges to draw (and why)

Source of truth: `code/05_network_maps.py` (copied unmodified into this
folder — read it alongside this section). This is the part you'll most want
to deviate from, since the whole point of an interactive site is to not be
limited by print constraints — but you need to understand the current
choices to (a) offer "what the paper shows" as a sensible default, and (b)
know exactly what "more" means.

### 3.1 The gene cap

A literal render of the full network (~2,000 edges among ~2,000-2,500 genes
per group) is an unreadable hairball as a static image. So the figure
instead shows a small **curated gene set** per compartment:

> the union of that compartment's **top-15 WOI-trajectory driver genes**
> (ranked by max |change in eigenvector centrality| across the four
> consecutive Fertile timepoint pairs) and **top-15 RIF-dysregulated genes**
> (ranked by |change in eigenvector centrality| between Fertile-LH+7 and
> RIF-LH+7)

`TOP_N_DRIVERS = 15` in the current code. (Note: some older docs in this
repo, and the figure script's own module-level docstring, still say
"top-20" — that's leftover from an earlier parameter value; the executable
`TOP_N_DRIVERS = 15` constant is what actually generated the current PNGs
and is what you should treat as ground truth. Both rankings' *full* top-20
list — the underlying data, before the 15-cap — is what's in
`top_WOI_regulators_ranked.csv` / `top_RIF_regulators_ranked.csv` per
compartment, so you have a bit of headroom beyond even the exact curated set
without needing any new ranking computation.)

This gives ~15-26 genes per compartment (`curated_hub_genes.csv` has the
exact list). **Only edges where BOTH endpoints are in this curated set are
drawn** — real edges to a gene outside the curated set are simply omitted
from the static figure, not because they're unimportant, but purely for
plot legibility.

### 3.2 What every visual element means

| Element | CellOracle panels (A, B) | dynGENIE3 panel (C) |
|---|---|---|
| Node = | a gene | a gene |
| Node size | that group's eigenvector centrality (per-timepoint in panel A; Fertile-LH+7 or RIF-LH+7 in panel B) | aggregate dynGENIE3 importance, **summed across ALL of that gene's target edges in the full importance table** — not just the edges drawn |
| Node color (fill) | violet = transcription factor (a candidate regulator in the base GRN — can have outgoing edges); salmon = target-only gene (can only be regulated, not itself a regulator in this framework); gray = isolated in this specific panel (no edge to another curated gene at this timepoint/condition — still a real, independently-important gene, just not wired to a neighbor *here*) | same TF/target-only/isolated logic |
| Edge = | source → target regulatory relationship (arrow points regulator → target) | same |
| Edge width | scaled `|coef_mean|` (absolute regression coefficient) | scaled dynGENIE3 `importance` score |
| Edge color (panel A, WOI) | single flat color (this panel doesn't encode gain/loss) | n/a |
| Edge color (panel B, Fertile vs RIF only) | gray = retained in both conditions; blue = gained in RIF; red = lost from Fertile | n/a |
| Cap | only edges between two curated genes | top 40 edges among the curated set by importance (dynGENIE3's candidate space is much denser, so it needs its own cap even within the already-small curated gene set) |

A gene is a **"transcription factor"** in this framework specifically if
it's a column in the base GRN (`data/tf_list.csv`, 1,094 genes) — i.e. it
has at least one candidate promoter-motif binding site somewhere in the
genome per CellOracle's precomputed hg38 motif scan. This is a property of
the gene, not of the compartment — the same `tf_list.csv` applies to every
compartment. "Target-only" just means "not in that list," not "unimportant."

### 3.3 Layout — important caveat if you build your own graph view

The static figure's node positions are **not** derived from the network
structure in any physically-meaningful, force-directed sense. It's a fixed,
deterministic **two-ring circular layout**: TFs on an inner ring, target-only
genes on an outer ring, computed *once* per compartment (from the union of
edges across every panel) and then reused unchanged across all
timepoints/conditions/methods — purely so a gene sits in the same visual
spot in every panel, making the figure readable as a "flipbook" of the same
network rewiring over time, at the cost of not reflecting real network
topology in the positions themselves.

For an interactive site you are **not bound by this constraint** — a
real force-directed layout (e.g. d3-force) will likely look and feel better
for exploration, especially once you're showing more than ~25 nodes. If you
do want timepoint-to-timepoint visual stability (so a gene doesn't jump
around as a user scrubs through LH+3→LH+11), consider computing one
force-directed layout from the *union* of edges across all groups (same
principle as the static figure) and holding it fixed while filtering which
edges/nodes are visible per timepoint — same idea, better positions.

## 4. Data dictionary (`data/`)

### 4.1 `data/tf_list.csv` (shared across all compartments)

| Column | Meaning |
|---|---|
| `gene` | gene symbol |
| `is_TF` | always `True` in this file — presence in the file itself is the signal. 1,094 genes total. Any gene NOT in this file, appearing anywhere else in the dataset, is target-only. |

### 4.2 `data/<compartment>/network_snapshots.csv` / `.json`

**The full, uncapped version of what feeds the CellOracle panels (A, B).**
One row per edge, per group. 2,000 edges × 6 groups = 12,000 rows per
compartment.

| Column | Meaning |
|---|---|
| `cluster` | which of the 6 groups this edge belongs to: `Fertile_LH+3`, `Fertile_LH+5`, `Fertile_LH+7`, `Fertile_LH+9`, `Fertile_LH+11`, or `RIF_LH+7` |
| `source` | regulator gene (arrow tail) |
| `target` | target gene (arrow head) |
| `coef_mean` | mean fitted regression coefficient across the 20 bootstrap bags — **signed**: positive = activating, negative = repressing |
| `coef_abs` | `|coef_mean|` — what the static figure scales edge width by |
| `p` | p-value for this edge (all rows already satisfy p < 0.001, the pruning threshold used when the network was fit) |
| `-logp` | `-log10(p)`, monotonic with confidence, sometimes more convenient to scale by than raw p |
| `source_is_TF` / `target_is_TF` | convenience booleans, precomputed from `tf_list.csv` so you don't need a join for basic styling |

### 4.3 `data/<compartment>/node_centrality.csv` / `.json`

Full per-gene, per-group network-topology summary — every gene that appears
as a node (source or target of at least one edge) in that group's network,
not just the curated set.

| Column | Meaning |
|---|---|
| `gene` | gene symbol |
| `cluster` | which of the 6 groups (same values as above) |
| `degree_all` / `degree_in` / `degree_out` | raw edge counts (total / incoming / outgoing) for this gene in this group's network |
| `degree_centrality_all` / `_in` / `_out` | same, normalized by network size |
| `betweenness_centrality` | how often this gene sits on the shortest path between other gene pairs — a "bridge/bottleneck" measure |
| `eigenvector_centrality` | **this is what the static figure uses for node size** in panels A/B — a gene is "important" here if it connects to other well-connected genes, not just if it has many edges |
| `is_TF` | precomputed from `tf_list.csv` |

### 4.4 `data/<compartment>/curated_hub_genes.csv`

The exact ~15-26 genes shown in the static PNG for this compartment — use
this to reproduce "what the paper figure shows" as a default/highlighted
view.

| Column | Meaning |
|---|---|
| `gene` | gene symbol |
| `is_TF` | from `tf_list.csv` |
| `in_top_WOI_drivers` | was this gene in the top-15 WOI-trajectory driver list |
| `in_top_RIF_drivers` | was this gene in the top-15 RIF-dysregulation driver list (a gene can be in both) |

### 4.5 `data/<compartment>/top_WOI_regulators_ranked.csv` and `top_RIF_regulators_ranked.csv`

The **full top-20** ranked lists the curated set is drawn from (15 of these
20 make it into the static figure, per compartment, per list) — richer than
`curated_hub_genes.csv`, with the actual ranking values. Row order is rank
order (best/most-shifted first).

`top_WOI_regulators_ranked.csv`:

| Column | Meaning |
|---|---|
| (index/first column) | gene symbol |
| `Fertile_LH+3_vs_Fertile_LH+5`, `Fertile_LH+5_vs_Fertile_LH+7`, `Fertile_LH+7_vs_Fertile_LH+9`, `Fertile_LH+9_vs_Fertile_LH+11` | eigenvector-centrality delta for that gene across each consecutive-timepoint pair (signed) |
| `max_abs_delta` | the largest \|delta\| across those four pairs — this is what determines the ranking |
| `dynGENIE3_TF_importance` | aggregate dynGENIE3 importance for this gene as a regulator (0 if the compartment has no dynGENIE3 model, or the gene isn't a regulator) |
| `dynGENIE3_validated` | `True` if this gene clears the dual-validation bar (§2.3) |

`top_RIF_regulators_ranked.csv`: same idea, but a single
`eigenvector_centrality_delta` column (Fertile-LH+7 → RIF-LH+7, signed;
ranking is by \|delta\|) in place of the four consecutive-pair columns.

### 4.6 `data/<compartment>/consecutive_timepoint_edge_diffs/*.csv` and `consecutive_timepoint_driver_diffs/*.csv`

One file per consecutive Fertile timepoint pair (4 files each:
`Fertile_LH+3_vs_Fertile_LH+5`, `..._LH+5_vs_..._LH+7`,
`..._LH+7_vs_..._LH+9`, `..._LH+9_vs_..._LH+11`) — the **full, uncapped**
edge-level and gene-level comparison between those two networks (this is
literally what the top-driver rankings above were computed from).

`*_edges.csv`: `source`, `target`, `coef_mean_a`/`coef_abs_a` (first
timepoint), `coef_mean_b`/`coef_abs_b` (second timepoint), `status`
(`retained` / `gained_in_<cluster>` / `lost_from_<cluster>`), `coef_delta`.

`*_drivers.csv`: per-gene centrality columns for both timepoints
side-by-side (suffixed `_<cluster_a>` / `_<cluster_b>`) plus a `_delta`
column for each — same metric set as `node_centrality.csv` §4.3.

### 4.7 `data/<compartment>/fertile_vs_rif_edge_diff.csv` and `fertile_vs_rif_driver_diff.csv`

Same structure as §4.6, but specifically Fertile-LH+7 vs. RIF-LH+7 — the
**full, uncapped** version of what panel B's edge-gain/loss coloring is
based on. If you want a Fertile-vs-RIF interactive view showing more than
the curated set, this file has every edge's gained/lost/retained status,
not just the ones between curated genes.

### 4.8 `data/<compartment>/dyngenie3_importances_full.csv` and `dyngenie3_importances_top100.csv`

| Column | Meaning |
|---|---|
| `regulator` | candidate TF (source of the arrow) |
| `target` | target gene |
| `importance` | dynGENIE3's continuous-dynamics regulatory importance score (unitless, relative within a compartment; not comparable across compartments) |

`_full.csv` is every regulator×target pair dynGENIE3 scored — **large**
(~1.48M rows, ~30MB per compartment). `_top100.csv` is a convenience cut:
the top 100 targets per regulator by importance (~59K rows) — still the
full gene universe (not the curated-15 restriction the static figure uses),
just pre-filtered to something you can reasonably load client-side. Neither
file exists for Tcell (§2.2).

**Practical note:** don't ship `_full.csv` straight to the browser as-is for
every compartment on page load — 30MB × 4 compartments is a lot for a
GitHub Pages static site to serve eagerly. Recommend using `_top100.csv` as
the default/initial data, and either lazy-loading `_full.csv` only if/when
a user asks to see a specific gene's complete edge list, or pre-aggregating
further server-side/build-time (e.g., top 20 instead of top 100) if 59K rows
per compartment is still too much for your target interaction (a force
layout with tens of thousands of edges will not render smoothly in-browser
regardless of file size — you'll want your own additional filtering step
for what's actually drawn at once, independent of what's loaded).

## 5. Biology context (short version)

- **Stromal** — dense, TF-cascade-driven network in every timepoint and
  condition. Hub cluster: RORA, ZEB1, EBF1, TCF7L2. RIF adds new edges
  converging on TCF7L2/EBF1 while the RORA/ZEB1 core stays wired in both
  conditions. This is the decidualization program.
- **Epithelial** — sparser, hub-centered. Most curated genes are
  unconnected in any single snapshot; the driver list leans on
  structural/ciliary genes (e.g. CFAP126, DYNLRB2, KIF9) that shift
  individually without being wired to each other. Primary hub: RFX3;
  secondary: KLF6, ID1, SOX6. RIF rewires around the same RFX3 hub (a few
  edges lost, a new cluster gained).
- **Tcell / uNK / ActivatedNK** — three separate, established
  tissue-resident immune programs (deliberately not merged into one
  "NK/T" bucket). Tcell has no dynGENIE3 model (§2.2).

Full biology interpretation and literature grounding:
`docs/biology_validation.txt` and `docs/FIGURE_DESCRIPTIONS.txt` (Section
5 of that file is specifically about these network-map figures and reads
well alongside this guide).

## 6. Assumptions and limitations

Things the website (and anyone using it) should not accidentally overclaim.
None of these are secret — they're all already documented in the source
repo — but they're easy to lose sight of once data is sitting in clean
CSVs, so they're collected here explicitly.

### 6.1 This is not causal validation

Every CellOracle edge combines a **sequence-based motif prior** (does this
TF have a plausible binding site near this gene's promoter, from a generic
hg38 motif scan — not from this cohort's chromatin) with a **statistical
association** (does this TF's expression predict this target's expression
across cells in this group). There is no chromatin-accessibility data
(ATAC-seq, ChIP-seq, etc.) for this specific cohort to confirm the motif
site is actually used, and no experimental perturbation data to confirm the
statistical association is causal. Treat every edge as "plausible regulatory
relationship supported by this analysis," not "proven regulatory
mechanism." (This applies to dynGENIE3 edges too, minus even the motif
prior — dynGENIE3 is purely a statistical-association model.) If the site
ever adds perturbation/knockout results (`figures/07_perturbation/`, not
part of this package), the same caveat applies even more strongly — those
are in-silico simulations conditioned on the fitted network, useful for
generating hypotheses, not confirming them.

### 6.2 Study-design confounds

- **Fertile subjects are destructively sampled, one timepoint per
  subject** — no subject contributes cells to more than one timepoint. So
  the "WOI trajectory" (LH+3 → LH+11) is a comparison *across different
  people*, not a true longitudinal/repeated-measures trajectory within the
  same individuals. Subject identity and timepoint are structurally
  confounded; this shaped several analysis choices upstream (e.g. why
  Harmony batch-correction was evaluated but rejected for pseudotime — see
  `docs/METHODS.txt`).
- **RIF was only sampled at LH+7.** There is no RIF trajectory across the
  cycle, and no dynGENIE3/pseudotime model exists for RIF at all (§2.2).
  Any Fertile-vs-RIF comparison in this data is valid *only* at LH+7 — never
  present a RIF data point as if it belongs anywhere else on a WOI-trajectory
  timeline.
- **RIF-vs-Fertile differential edges have not been tested per-sample.**
  The `fertile_vs_rif_edge_diff.csv` gained/lost/retained calls are computed
  from the pooled RIF-LH+7 vs. pooled Fertile-LH+7 networks, not verified to
  be consistent across the 10 RIF / matched Fertile-LH+7 subjects
  individually. A flagged-but-not-yet-closed gap in the source analysis — if
  the site highlights a specific "gained in RIF" edge as notable, avoid
  wording that implies it was confirmed to be a consistent, cohort-wide
  effect rather than a pooled-network observation.

### 6.3 Pseudotime reliability varies sharply by compartment

dynGENIE3 (§2.2) depends entirely on how well each compartment's pseudotime
recovers real chronological order. This is **not uniformly reliable**:
Stromal's pseudotime is the strongest in the analysis; Epithelial's is
distinctly weaker (the source documentation is not fully consistent on the
exact correlation value — `docs/METHODS.txt` reports Spearman rho = 0.74
for Epithelial after restricting to the secretory-differentiation lineage,
while `docs/research_question.txt`'s pre-registered checking rubric warns
against treating an earlier, lower reported value — rho ≈ 0.21-0.25 — as
resolved; both agree Epithelial should be treated with more caution than
Stromal, whatever the precise current number is). Practical rule: if the
site ever surfaces a pseudotime-based (dynGENIE3) claim for Epithelial, it
should read with visibly less confidence than the equivalent Stromal claim,
not side by side as equally solid. uNK (rho=0.55) and ActivatedNK (rho=0.36)
are weaker still (they still cleared the rho ≥ 0.3 validation gate, unlike
Tcell). Tcell (rho=0.23) failed the gate entirely and has no dynGENIE3 model
(§2.2) — this is not optional caution, it's a hard exclusion already baked
into the data you have (no `dyngenie3_*` files for Tcell).

### 6.4 Statistical caveats specific to the numbers in this package

- **dynGENIE3 importance scores can be degenerate** for a thin
  compartment/gene (near-zero variance across the importance distribution),
  which would make "top edges by importance" essentially noise-ranked rather
  than meaningfully ranked for that slice of data. The original pipeline
  (`src/06_run_dyngenie3.py`) checks and warns on this at the whole-compartment
  level at generation time; it was not re-checked per-gene when exporting
  `dyngenie3_importances_*.csv` here. If a specific gene's dynGENIE3 ranking
  looks suspicious (e.g. many near-identical importance values), don't treat
  it as a confirmed finding without flagging it back to the analysis side.
- **`coef_mean`'s sign** (activating vs. repressing, §4.2) is the sign of a
  fitted ridge-regression coefficient under this specific model, not a
  directly measured biochemical activation/repression readout.
- **Compartments are not comparable to each other on absolute network
  size** (edge count, node count, density) — cell counts differ up to ~4x
  between compartments (§1 table), which alone would produce different
  network sizes independent of any real biological difference. Compare a
  compartment's network across time/condition (what the analysis is
  designed for), not Stromal's node count against Epithelial's.
- **Cell-type composition differences between Fertile and RIF** (e.g.
  Stromal proportionally enriched in RIF; Unciliated Epithelial and B cells
  depleted — see `docs/DATA_CONTEXT.txt`) are visible in the source data but
  have **not been formally statistically tested** (e.g. no scCODA-style
  compositional test was run). If the site shows or implies anything about
  cell-type proportions alongside the network data, don't present that as a
  statistically confirmed result.

### 6.5 What this package deliberately does not include

- No raw/unnormalized counts anywhere upstream of this package — the
  source data is log1p-normalized only (no `raw` slot retained), so nothing
  here can be renormalized a different way without re-acquiring the
  original Cell Ranger matrices per sample.
- No perturbation/knockout data (`figures/07_perturbation/`, `results/perturbation/`)
  — out of scope for this handoff; ask if the site should eventually cover
  simulated TF-knockout results too, that would be a separate export.
- No cell-level (single-cell resolution) expression data — everything here
  is network-level (gene × gene edges, gene × group centrality/importance).
  If the site wants to show actual expression trends (e.g. "does PAEP go up
  across the WOI"), that's a different export from the processed AnnData
  objects, not covered here.

## 7. Where to go for more

Everything above is a summary written specifically for building this
website. If a question comes up that this document doesn't answer, these
are the authoritative sources, one level up in the repo:

- `docs/METHODS.txt` — full publication-style methods (exact statistics,
  every parameter, every QC decision)
- `docs/research_question.txt` — what the whole analysis is trying to
  answer, and what would falsify it
- `docs/biology_validation.txt` — literature-graded checklist for what a
  biologically sound result should look like
- `docs/FIGURE_DESCRIPTIONS.txt` — human-readable interpretation of every
  figure, including the ones this package is based on
- `docs/PIPELINE_PARAMETERS.md` — every frozen numeric parameter in one
  table (base network, bagging, edge caps, pseudotime gate, etc.)
- `docs/DEVELOPMENT_LOG.txt` — full history of corrections/bugs found
  during the original analysis, if something looks like it might be an
  artifact
