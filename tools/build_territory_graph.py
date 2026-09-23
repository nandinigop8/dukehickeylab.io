"""
Build the "territory" graph JSON for the interactive site (one compartment).

Reads the exported CellOracle data in Nandini_Website/data/<compartment>/ and
writes local_host_development/site/data/<compartment>_graph.json containing:

  - every gene in the UNION of the 6 CellOracle networks (5 Fertile
    timepoints + RIF LH+7), with a FIXED position that is shared by every
    view, so genes never move between Fertile/RIF or across LH+3 -> LH+11;
  - every union edge with its signed coef_mean in each of the 6 groups
    (null where the edge is absent from that group's top-2,000 network) --
    gained/lost/retained status for any pair of groups is derived from this
    presence/absence, and is checked below against the exported diff files;
  - "territories": network modules found by Leiden community detection on
    the union graph, each with a hub TF placed at its centre.

Territories are a layout/visualisation aid (an algorithmic grouping of the
union graph), not a biological result. Nothing here refits a network.

Needs pandas, numpy, python-igraph, leidenalg. On this machine:
    ~/anaconda3/envs/rapids_singlecell/bin/python \
        local_host_development/script/build_territory_graph.py stromal
(run from Nandini_Website/; the celloracle_grn env also works.)
"""
import json
import math
import random
import sys
from pathlib import Path

import igraph as ig
import leidenalg
import numpy as np
import pandas as pd

SEED = 42
GROUPS = ["Fertile_LH+3", "Fertile_LH+5", "Fertile_LH+7",
          "Fertile_LH+9", "Fertile_LH+11", "RIF_LH+7"]
LEIDEN_RESOLUTION = 1.0
MIN_MODULE_SIZE = 12      # smaller modules are merged into their best-connected neighbour
TERRITORY_DENSITY = 1.0   # graph units of radius per sqrt(gene count)
TERRITORY_GAP = 3.0       # min empty space between territory edges (room for highways)
TERRITORY_SPREAD = 6.0    # extra distance (x mean radius) for the least-connected pairs; chosen by sweep (see progress.txt)

# Categorical territory colors for a dark canvas. Deliberately avoids the
# blue (#2a78d6, gained) and red (#e34948, lost) used for edge status.
TERRITORY_COLORS = [
    "#4fd1c5", "#f6c85f", "#c792ea", "#9bdc7a", "#f78fb3", "#ffab70",
    "#d4c28a", "#80cbc4", "#e5a5ff", "#c3e88d", "#ffcb8b", "#a3b8cc",
]

from _paths import paths

P = paths(__file__)
ROOT, EXPORTS, OUT_DIR = P["root"], P["exports"], P["site_data"]


def load(compartment):
    d = EXPORTS / compartment
    snap = pd.read_csv(d / "network_snapshots.csv")
    cent = pd.read_csv(d / "node_centrality.csv")
    tfs = set(pd.read_csv(EXPORTS / "tf_list.csv")["gene"])
    curated = pd.read_csv(d / "curated_hub_genes.csv").set_index("gene")
    woi = pd.read_csv(d / "top_WOI_regulators_ranked.csv", index_col=0)
    rif = pd.read_csv(d / "top_RIF_regulators_ranked.csv", index_col=0)
    return d, snap, cent, tfs, curated, woi, rif


def check_diffs(d, coef):
    """Presence/absence in the union table must reproduce the exported diffs."""
    pairs = [(GROUPS[i], GROUPS[i + 1]) for i in range(4)]
    pairs.append(("Fertile_LH+7", "RIF_LH+7"))
    for a, b in pairs:
        fname = (d / "fertile_vs_rif_edge_diff.csv" if b == "RIF_LH+7"
                 else d / "consecutive_timepoint_edge_diffs" / f"{a}_vs_{b}.csv")
        diff = pd.read_csv(fname)
        got = {
            "retained": int((coef[a].notna() & coef[b].notna()).sum()),
            f"gained_in_{b}": int((coef[a].isna() & coef[b].notna()).sum()),
            f"lost_from_{a}": int((coef[a].notna() & coef[b].isna()).sum()),
        }
        want = diff["status"].value_counts().to_dict()
        assert got == want, f"{a} vs {b}: derived {got} != exported {want}"
        print(f"  diff check OK  {a} vs {b}: {got}")


def find_modules(nodes, und_edges):
    idx = {g: i for i, g in enumerate(nodes)}
    g = ig.Graph(n=len(nodes), edges=[(idx[a], idx[b]) for a, b, _ in und_edges])
    g.es["weight"] = [w for _, _, w in und_edges]
    part = leidenalg.find_partition(
        g, leidenalg.RBConfigurationVertexPartition, weights="weight",
        resolution_parameter=LEIDEN_RESOLUTION, seed=SEED, n_iterations=-1)
    memb = list(part.membership)

    # Merge small modules into the module they share the most edge weight with.
    while True:
        sizes = pd.Series(memb).value_counts()
        small = sizes[sizes < MIN_MODULE_SIZE]
        if small.empty:
            break
        m = small.index[-1]  # smallest first
        link = {}
        for e in g.es:
            a, b = e.tuple
            ma, mb = memb[a], memb[b]
            if (ma == m) != (mb == m):
                other = mb if ma == m else ma
                link[other] = link.get(other, 0) + e["weight"]
        if not link:  # disconnected tiny component: leave as its own module
            break
        target = max(link, key=link.get)
        memb = [target if x == m else x for x in memb]

    # Relabel 0..k-1 by descending size.
    order = pd.Series(memb).value_counts().index.tolist()
    remap = {old: new for new, old in enumerate(order)}
    return g, [remap[x] for x in memb]


def disk_layout(sub, hub_local, radius, rng_seed):
    """Force layout of one module, warped into a disk with the hub at the centre.

    Angles and the distance ORDER from the hub come from the force layout (so
    neighbours stay near each other); radii are re-spaced to fill the disk
    evenly, which gives each territory the same round, readable shape.
    """
    n = sub.vcount()
    if n == 1:
        return np.zeros((1, 2))
    random.seed(rng_seed)
    lay = np.array(sub.layout_fruchterman_reingold(weights="weight", niter=1500).coords)
    lay -= lay[hub_local]
    ang = np.arctan2(lay[:, 1], lay[:, 0])
    dist = np.hypot(lay[:, 0], lay[:, 1])
    others = [i for i in range(n) if i != hub_local]
    ranks = np.argsort(np.argsort(dist[others]))
    r = np.zeros(n)
    # Leave a small empty ring around the hub so its label and glow stay clear.
    r[others] = radius * (0.18 + 0.82 * np.sqrt((ranks + 0.5) / len(others)))
    return np.column_stack([r * np.cos(ang), r * np.sin(ang)])


def territory_affinity(meta_weights, k):
    """Size-independent connection strength between territories.

    a_ij = w_ij / sqrt(S_i * S_j), where w_ij is the summed edge weight between
    territories i and j and S_i is territory i's total cross-territory weight.
    Raw w_ij would make the biggest territories look close to everything;
    this normalisation asks "how much of each territory's outside traffic
    goes to the other one". Range 0..1.
    """
    w = np.zeros((k, k))
    for (i, j), v in meta_weights.items():
        w[i, j] = w[j, i] = v
    s = w.sum(axis=1)
    denom = np.sqrt(np.outer(s, s))
    return np.divide(w, denom, out=np.zeros_like(w), where=denom > 0)


def _rank(x):
    r = np.empty(len(x))
    r[np.argsort(x, kind="mergesort")] = np.arange(len(x))
    # average ties
    for v in np.unique(x):
        idx = np.where(x == v)[0]
        r[idx] = r[idx].mean()
    return r


def placement_report(pos, radii, aff):
    """Spearman correlation between affinity and (a) centre distance and
    (b) edge-to-edge gap. Strongly negative = strongly linked territories sit
    closer together, i.e. position reflects interaction."""
    k = len(radii)
    iu = np.triu_indices(k, 1)
    d = np.linalg.norm(pos[:, None] - pos[None], axis=2)[iu]
    gap = d - (np.add.outer(radii, radii))[iu]
    a = aff[iu]
    rho = lambda x, y: float(np.corrcoef(_rank(x), _rank(y))[0, 1])
    return {"spearman_affinity_vs_centre_distance": round(rho(a, d), 3),
            "spearman_affinity_vs_gap": round(rho(a, gap), 3),
            "min_gap": round(float(gap.min()), 3)}


def place_territories(meta_weights, radii):
    """Territory centres whose distances reflect how strongly they interact.

    1. Target distance per pair: touching distance (r_i + r_j + gap) plus an
       extra stretch that shrinks to 0 for the most strongly linked pair and
       grows to TERRITORY_SPREAD for unlinked pairs.
    2. Weighted stress majorisation (SMACOF, weights 1/d^2) finds positions
       whose distances best match the targets, starting from classical MDS.
    3. Push-only overlap removal guarantees no two territories overlap.
    4. Rotate so the long axis is horizontal (the canvas is wider than tall).
    """
    k = len(radii)
    radii = np.asarray(radii, float)
    aff = territory_affinity(meta_weights, k)
    amax = aff.max() or 1.0
    contact = np.add.outer(radii, radii) + TERRITORY_GAP
    spread = TERRITORY_SPREAD * radii.mean()
    D = contact + spread * (1 - aff / amax) ** 1.5
    np.fill_diagonal(D, 0)

    # Classical MDS start.
    J = np.eye(k) - 1.0 / k
    B = -0.5 * J @ (D ** 2) @ J
    vals, vecs = np.linalg.eigh(B)
    top = np.argsort(vals)[::-1][:2]
    X = vecs[:, top] * np.sqrt(np.maximum(vals[top], 1e-9))

    # SMACOF with weights 1/d^2 (local distances matter most).
    W = np.divide(1.0, D ** 2, out=np.zeros_like(D), where=D > 0)
    V = -W.copy()
    np.fill_diagonal(V, W.sum(axis=1))
    Vp = np.linalg.pinv(V)
    for _ in range(3000):
        dist = np.linalg.norm(X[:, None] - X[None], axis=2)
        Bm = np.divide(-W * D, dist, out=np.zeros_like(D), where=dist > 1e-9)
        np.fill_diagonal(Bm, -Bm.sum(axis=1))
        Xn = Vp @ Bm @ X
        if np.abs(Xn - X).max() < 1e-7:
            X = Xn
            break
        X = Xn

    # Push-only overlap removal.
    for _ in range(5000):
        moved = False
        for i in range(k):
            for j in range(i + 1, k):
                dv = X[j] - X[i]
                dist = math.hypot(*dv) or 1e-6
                need = contact[i, j]
                if dist < need - 1e-6:
                    push = (need - dist) / 2 * dv / dist
                    X[i] -= push
                    X[j] += push
                    moved = True
        if not moved:
            break

    X -= X.mean(axis=0)
    _, _, vt = np.linalg.svd(X, full_matrices=False)
    X = X @ vt.T
    return X, aff


def main(compartment):
    d, snap, cent, tfs, curated, woi, rif = load(compartment)
    print(f"[{compartment}] {len(snap)} edge rows")

    coef = snap.pivot_table(index=["source", "target"], columns="cluster",
                            values="coef_mean", aggfunc="first").reindex(columns=GROUPS)
    check_diffs(d, coef)

    nodes = sorted(set(snap["source"]) | set(snap["target"]))
    print(f"  union: {len(nodes)} genes, {len(coef)} directed edges")

    # Undirected weight = summed |coef| over every group the edge appears in,
    # so edges that persist across the cycle bind genes together more strongly.
    und = {}
    for (s, t), row in coef.iterrows():
        key = tuple(sorted((s, t)))
        und[key] = und.get(key, 0.0) + float(np.nansum(np.abs(row.values)))
    und_edges = [(a, b, w) for (a, b), w in und.items()]

    g, memb = find_modules(nodes, und_edges)
    k = max(memb) + 1
    sizes = [memb.count(m) for m in range(k)]
    print(f"  {k} territories, sizes {sizes}")

    # Hub = TF with the largest weighted degree inside its own module.
    strength_in = [0.0] * len(nodes)
    for e in g.es:
        a, b = e.tuple
        if memb[a] == memb[b]:
            strength_in[a] += e["weight"]
            strength_in[b] += e["weight"]
    hubs = []
    for m in range(k):
        members = [i for i in range(len(nodes)) if memb[i] == m]
        tf_members = [i for i in members if nodes[i] in tfs] or members
        hubs.append(max(tf_members, key=lambda i: strength_in[i]))
    print("  hubs:", [nodes[h] for h in hubs])

    radii = [TERRITORY_DENSITY * math.sqrt(s) for s in sizes]
    meta = {}
    for e in g.es:
        a, b = e.tuple
        ma, mb = memb[a], memb[b]
        if ma != mb:
            key = (min(ma, mb), max(ma, mb))
            meta[key] = meta.get(key, 0.0) + e["weight"]
    centres, aff = place_territories(meta, radii)
    report = placement_report(centres, radii, aff)
    print("  placement:", report)
    assert report["min_gap"] >= TERRITORY_GAP - 1e-3, "territories overlap"

    xy = np.zeros((len(nodes), 2))
    for m in range(k):
        members = [i for i in range(len(nodes)) if memb[i] == m]
        sub = g.subgraph(members)
        local = disk_layout(sub, members.index(hubs[m]), radii[m], SEED + m)
        xy[members] = local + centres[m]

    # Per-gene, per-group centrality (null where the gene is absent).
    eig = cent.pivot_table(index="gene", columns="cluster",
                           values="eigenvector_centrality").reindex(columns=GROUPS)
    deg = cent.pivot_table(index="gene", columns="cluster",
                           values="degree_all").reindex(columns=GROUPS)

    def num(v, nd=4):
        return None if pd.isna(v) else round(float(v), nd)

    def rank_of(df, gene):
        return int(df.index.get_loc(gene)) + 1 if gene in df.index else None

    has_dyn = "dynGENIE3_validated" in woi.columns and woi["dynGENIE3_TF_importance"].abs().sum() > 0
    dual = set(woi.index[woi["dynGENIE3_validated"]]) | set(rif.index[rif["dynGENIE3_validated"]])

    hub_set = set(hubs)
    out_nodes = []
    for i, gname in enumerate(nodes):
        out_nodes.append({
            "id": gname,
            "x": round(float(xy[i, 0]), 3),
            "y": round(float(xy[i, 1]), 3),
            "m": memb[i],
            "tf": gname in tfs,
            "hub": i in hub_set,
            "curated": gname in curated.index,
            "dual": (gname in dual) if has_dyn else None,
            "woiRank": rank_of(woi, gname),
            "rifRank": rank_of(rif, gname),
            "eig": [num(eig.at[gname, c]) if gname in eig.index else None for c in GROUPS],
            "deg": [None if (gname not in deg.index or pd.isna(deg.at[gname, c]))
                    else int(deg.at[gname, c]) for c in GROUPS],
        })

    idx = {gname: i for i, gname in enumerate(nodes)}
    out_edges = [[idx[s], idx[t], [num(v) for v in row.values]]
                 for (s, t), row in coef.iterrows()]

    out = {
        "compartment": compartment,
        "method": "CellOracle",
        "groups": GROUPS,
        "dynGENIE3Available": bool(has_dyn),
        "placement": report,
        "params": {"leidenResolution": LEIDEN_RESOLUTION, "minModuleSize": MIN_MODULE_SIZE,
                   "territorySpread": TERRITORY_SPREAD,
                   "seed": SEED, "edgeWeight": "sum of |coef_mean| over groups"},
        "territories": [{
            "id": m, "hub": nodes[hubs[m]], "size": sizes[m],
            "x": round(float(centres[m, 0]), 3), "y": round(float(centres[m, 1]), 3),
            "r": round(radii[m], 3), "color": TERRITORY_COLORS[m % len(TERRITORY_COLORS)],
        } for m in range(k)],
        "nodes": out_nodes,
        "edges": out_edges,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{compartment}_graph.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "stromal")
