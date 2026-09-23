"""
Build literature annotations for every gene and edge shown on the site.

Nothing here is written from memory: every text and every citation comes
from a public, attributable source, fetched and cached by this script.

Per gene (all genes in any compartment's CellOracle network):
  - name / type / general function summary ...... NCBI Gene RefSeq summary
                                                   (via MyGene.info)
  - implantation-specific statements ............. NCBI GeneRIFs whose text
                                                   mentions decidua/implantation/
                                                   receptivity/endometrium, each
                                                   with its PubMed ID
  - implantation paper count + recent papers ..... NCBI Gene -> PubMed links
                                                   (gene_pubmed) filtered by the
                                                   IMPLANTATION_QUERY below
  - evidence tier ................................ from that paper count
                                                   (thresholds in TIERS)
  - curated implantation note .................... ../curation/implantation_gene_notes.csv
                                                   (hand-written, cites PMIDs from
                                                   the sources above; has a
                                                   review-status column)

Per edge (TF -> target):
  - literature support ........................... CollecTRI (Mueller-Dott et al.
                                                   2023, curated TF-target
                                                   interactions from 12 resources),
                                                   via OmniPath: sign + PubMed refs

Outputs (site/data/):
  <compartment>_annotations.json   genes of that compartment only
  literature_edges.json            CollecTRI edges that occur in any
                                   compartment's network

Raw downloads are cached in local_host_development/.cache/ (re-used on
re-runs; delete it to refresh). Standard library only:
    python3 local_host_development/script/build_gene_annotations.py
(run from Nandini_Website/; needs internet on the first run, ~5-10 min.)
"""
import csv
import glob
import gzip
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from _paths import paths

P = paths(__file__)
ROOT, EXPORTS = P["root"], P["exports"]
CACHE, OUT = P["cache"], P["site_data"]
NOTES = P["curation"] / "implantation_gene_notes.csv"

IMPLANTATION_QUERY = (
    '("Embryo Implantation"[Mesh] OR "Decidua"[Mesh] OR decidualization[tiab] '
    'OR decidualisation[tiab] OR "endometrial receptivity"[tiab] '
    'OR "window of implantation"[tiab] OR "implantation failure"[tiab] '
    'OR "uterine receptivity"[tiab])'
)
# GeneRIF text classification. "implantation"/"receptivity" alone are not
# enough (device/valve/stem-cell "implantation", neural "receptive" fields),
# so they only count alongside a reproductive-context word; "deciduous"
# (teeth) is excluded. Endometrial disease statements without these terms
# fall into the separate "other endometrium" group.
_REPRO = r"(embryo|uter|endometri|pregnan|blastocyst|\bIVF\b|fertili|trophoblast|miscarr|decidu(?!ous))"
RIF_IMPLANTATION_STRICT = re.compile(
    r"decidu(?!ous)|blastocyst|window of implantation|implantation failure|implantation window", re.I)
RIF_IMPLANTATION_CTX = re.compile(r"implantation|receptiv", re.I)
RIF_REPRO = re.compile(_REPRO, re.I)
RIF_ENDOMETRIUM = re.compile(r"endometri|uter(us|ine)|menstru", re.I)


def is_implantation_rif(text):
    return bool(RIF_IMPLANTATION_STRICT.search(text)
                or (RIF_IMPLANTATION_CTX.search(text) and RIF_REPRO.search(text)))
# Evidence tier from the number of NCBI-linked implantation/decidualization papers.
TIERS = [(10, "strong"), (3, "moderate"), (1, "limited"), (0, "none")]

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
GENERIF_URL = "https://ftp.ncbi.nlm.nih.gov/gene/GeneRIF/generifs_basic.gz"
COLLECTRI_URL = ("https://omnipathdb.org/interactions?datasets=collectri&genesymbols=yes"
                 "&organisms=9606&fields=references,curation_effort")
UA = {"User-Agent": "endometrial-grn-site/0.1 (academic, non-commercial)"}


# ---------------------------------------------------------------- http helpers
def http(url, data=None, tries=4):
    body = urllib.parse.urlencode(data, doseq=True).encode() if data else None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 -- network hiccups: retry with backoff
            if i == tries - 1:
                raise
            print(f"    retry {i + 1} ({e})")
            time.sleep(2 * (i + 1))


def cached(name, fetch):
    p = CACHE / name
    if not p.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        p.write_bytes(fetch())
    return p


def eutils(tool, params, tries=4):
    time.sleep(0.4)  # NCBI: max 3 requests/s without an API key
    return json.loads(http(f"{EUTILS}/{tool}.fcgi", {**params, "retmode": "json"}, tries=tries))


# ---------------------------------------------------------------- steps
def all_genes():
    genes, per_comp = set(), {}
    for f in sorted(glob.glob(str(EXPORTS / "*" / "network_snapshots.csv"))):
        comp = Path(f).parent.name
        s = set()
        with open(f) as fh:
            for r in csv.DictReader(fh):
                s.add(r["source"]); s.add(r["target"])
        per_comp[comp] = s
        genes |= s
    return sorted(genes), per_comp


def mygene(genes):
    def fetch():
        out = []
        for i in range(0, len(genes), 1000):
            out += json.loads(http("https://mygene.info/v3/query", {
                "q": ",".join(genes[i:i + 1000]), "scopes": "symbol",
                "species": "human", "fields": "entrezgene,name,summary,type_of_gene,alias,other_names",
            }))
        return json.dumps(out).encode()
    hits = json.loads(cached("mygene_v2.json", fetch).read_text())
    info = {}
    for h in hits:
        q = h["query"]
        if h.get("notfound") or q in info or "entrezgene" not in h:
            continue
        as_list = lambda v: [v] if isinstance(v, str) else list(v or [])
        info[q] = {"entrez": str(h["entrezgene"]), "name": h.get("name"),
                   "type": h.get("type_of_gene"), "summary": h.get("summary"),
                   # alternative symbols (e.g. PLZF for ZBTB16) and names (e.g. COUP-TFII)
                   "aliases": [a for a in as_list(h.get("alias")) if a != q][:8],
                   "otherNames": as_list(h.get("other_names"))[:4]}
    return info


def generifs(entrez_to_gene):
    raw = cached("generifs_basic.gz", lambda: http(GENERIF_URL))
    impl, endo = {}, {}
    with gzip.open(raw, "rt", encoding="utf-8", errors="replace") as fh:
        next(fh)
        for line in fh:
            tax, gid, pmids, _ts, text = line.rstrip("\n").split("\t", 4)
            if tax != "9606" or gid not in entrez_to_gene:
                continue
            g = entrez_to_gene[gid]
            rec = {"text": text.strip(), "pmid": pmids.split(",")[0]}
            if is_implantation_rif(text):
                impl.setdefault(g, []).append(rec)
            elif RIF_ENDOMETRIUM.search(text):
                endo.setdefault(g, []).append(rec)
    # Newest first (PMIDs increase over time).
    for d in (impl, endo):
        for g in d:
            d[g].sort(key=lambda r: -int(r["pmid"]) if r["pmid"].isdigit() else 0)
    return impl, endo


def implantation_papers(info):
    def fetch():
        ids = [v["entrez"] for v in info.values()]
        links = {}

        def run(batch):
            # Filtered elink is heavy on NCBI's side: on failure, split the batch.
            try:
                d = eutils("elink", {"dbfrom": "gene", "db": "pubmed", "linkname": "gene_pubmed",
                                     "id": batch, "term": IMPLANTATION_QUERY}, tries=2)
            except Exception:  # noqa: BLE001
                if len(batch) == 1:
                    raise
                half = len(batch) // 2
                run(batch[:half]); run(batch[half:])
                return
            for ls in d.get("linksets", []):
                gid = ls["ids"][0]
                links[gid] = [x for db in ls.get("linksetdbs", []) for x in db.get("links", [])]

        step = 20
        for i in range(0, len(ids), step):
            run(ids[i:i + step])
            if (i // step) % 10 == 0:
                print(f"    elink {min(i + step, len(ids))}/{len(ids)}")
        missing = [g for g in ids if g not in links]
        assert not missing, f"elink returned no linkset for {len(missing)} genes"
        return json.dumps(links).encode()
    links = json.loads(cached("gene_pubmed_implantation.json", fetch).read_text())

    # Titles for the 3 most recent papers per gene.
    want = sorted({p for v in links.values() for p in sorted(v, key=int, reverse=True)[:3]})

    def fetch_meta():
        meta = {}
        for i in range(0, len(want), 200):
            d = eutils("esummary", {"db": "pubmed", "id": ",".join(want[i:i + 200])})
            for pid in d["result"].get("uids", []):
                r = d["result"][pid]
                meta[pid] = {"title": r.get("title", "").rstrip("."),
                             "journal": r.get("source", ""),
                             "year": (r.get("pubdate", "") or "")[:4]}
            print(f"    esummary {min(i + 200, len(want))}/{len(want)}")
        return json.dumps(meta).encode()
    meta = json.loads(cached("pubmed_meta.json", fetch_meta).read_text())
    return links, meta


def collectri(union_pairs):
    raw = cached("collectri.tsv", lambda: http(COLLECTRI_URL)).read_text().splitlines()
    head = raw[0].split("\t")
    col = {k: i for i, k in enumerate(head)}
    out = {}
    for line in raw[1:]:
        f = line.split("\t")
        key = f"{f[col['source_genesymbol']]}>{f[col['target_genesymbol']]}"
        if key not in union_pairs:
            continue
        stim, inhib = f[col["consensus_stimulation"]] == "True", f[col["consensus_inhibition"]] == "True"
        refs = sorted({r.split(":")[-1] for r in f[col["references"]].split(";") if r},
                      key=lambda x: -int(x) if x.isdigit() else 0)
        if not refs:  # CollecTRI rows without any reference are not "literature-supported"
            continue
        out[key] = {"sign": "+" if stim and not inhib else "-" if inhib and not stim else "?",
                    "nRefs": len(refs), "refs": refs[:5]}
    return out


def read_notes():
    if not NOTES.exists():
        return {}
    with open(NOTES, newline="") as fh:
        return {r["gene"]: {
            "text": r["note"].strip(),
            "pmids": [p.strip() for p in r["pmids"].split(";") if p.strip()],
            "status": r["status"].strip(),
            "reviewer": r.get("reviewer", "").strip(),
        } for r in csv.DictReader(fh) if r.get("note", "").strip()}


def check_notes(notes, info, rif_impl, rif_endo, links):
    """Every PMID a curated note cites must be part of that gene's retrieved
    evidence (its GeneRIFs or its NCBI-linked implantation papers); the build
    stops otherwise. Returns {pmid: {pmid, title, journal, year}} from PubMed."""
    problems = []
    for g, n in notes.items():
        i = info.get(g)
        if not i:
            problems.append(f"{g}: gene not found in NCBI")
            continue
        allowed = ({r["pmid"] for r in rif_impl.get(g, []) + rif_endo.get(g, [])}
                   | set(links.get(i["entrez"], [])))
        bad = [p for p in n["pmids"] if p not in allowed]
        if not n["pmids"]:
            problems.append(f"{g}: note has no PMIDs")
        if bad:
            problems.append(f"{g}: PMIDs not in this gene's retrieved evidence: {bad}")
        if n["status"] not in ("draft", "reviewed"):
            problems.append(f"{g}: status must be 'draft' or 'reviewed', got {n['status']!r}")
    if problems:
        print("CURATION CHECK FAILED:\n  " + "\n  ".join(problems))
        sys.exit(1)
    print(f"    curation check OK: {sum(len(n['pmids']) for n in notes.values())} citations, "
          "all traceable to retrieved evidence")

    path = CACHE / "note_citations.json"
    meta = json.loads(path.read_text()) if path.exists() else {}
    need = sorted({p for n in notes.values() for p in n["pmids"]} - set(meta))
    for i in range(0, len(need), 200):
        d = eutils("esummary", {"db": "pubmed", "id": ",".join(need[i:i + 200])})
        for pid in d["result"].get("uids", []):
            r = d["result"][pid]
            meta[pid] = {"pmid": pid, "title": r.get("title", "").rstrip("."),
                         "journal": r.get("source", ""), "year": (r.get("pubdate", "") or "")[:4]}
    path.write_text(json.dumps(meta))
    missing = [p for n in notes.values() for p in n["pmids"] if p not in meta]
    if missing:
        print(f"CURATION CHECK FAILED: PubMed returned no record for {missing}")
        sys.exit(1)
    return meta


def tier(n):
    return next(label for cut, label in TIERS if n >= cut)


def main():
    genes, per_comp = all_genes()
    print(f"{len(genes)} genes across {len(per_comp)} compartments")

    print("[1/4] NCBI gene summaries (MyGene.info)")
    info = mygene(genes)
    print(f"    matched {len(info)}/{len(genes)}")
    entrez_to_gene = {v["entrez"]: g for g, v in info.items()}

    print("[2/4] GeneRIFs")
    rif_impl, rif_endo = generifs(entrez_to_gene)
    print(f"    genes with implantation GeneRIFs: {len(rif_impl)}")

    print("[3/4] NCBI gene -> PubMed (implantation/decidualization)")
    links, meta = implantation_papers(info)

    print("[4/4] CollecTRI TF-target literature")
    union_pairs = set()
    for f in glob.glob(str(EXPORTS / "*" / "network_snapshots.csv")):
        with open(f) as fh:
            union_pairs |= {f"{r['source']}>{r['target']}" for r in csv.DictReader(fh)}
    lit_edges = collectri(union_pairs)
    print(f"    {len(lit_edges)}/{len(union_pairs)} network edges have CollecTRI support")

    notes = read_notes()
    print(f"    curated notes: {len(notes)}")
    cites = check_notes(notes, info, rif_impl, rif_endo, links)

    ann = {}
    for g in genes:
        i = info.get(g, {})
        pm = sorted(links.get(i.get("entrez", ""), []), key=int, reverse=True)
        ann[g] = {
            "name": i.get("name"),
            "entrez": i.get("entrez"),
            "type": i.get("type"),
            "summary": i.get("summary"),
            "aliases": i.get("aliases", []),
            "otherNames": i.get("otherNames", []),
            "nImpl": len(pm),
            "tier": tier(len(pm)),
            "papers": [{"pmid": p, **meta[p]} for p in pm[:3] if p in meta],
            "rifsImpl": rif_impl.get(g, [])[:6],
            "nRifsImpl": len(rif_impl.get(g, [])),
            "rifsEndo": rif_endo.get(g, [])[:3],
            "nRifsEndo": len(rif_endo.get(g, [])),
            "note": ({**notes[g], "cites": [cites[p] for p in notes[g]["pmids"]]}
                     if g in notes else None),
        }

    OUT.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d")
    sources = {
        "built": stamp,
        "summary": "NCBI Gene RefSeq summary via MyGene.info",
        "generifs": "NCBI GeneRIF (generifs_basic), filtered by text for implantation/endometrium",
        "papers": "NCBI Gene->PubMed links filtered by: " + IMPLANTATION_QUERY,
        "tiers": {label: f">= {cut} papers" for cut, label in TIERS},
        "edges": "CollecTRI via OmniPath (Mueller-Dott et al. 2023, NAR)",
    }
    for comp, gs in per_comp.items():
        p = OUT / f"{comp}_annotations.json"
        p.write_text(json.dumps({"sources": sources, "genes": {g: ann[g] for g in sorted(gs)}},
                                separators=(",", ":")))
        counts = {}
        for g in gs:
            counts[ann[g]["tier"]] = counts.get(ann[g]["tier"], 0) + 1
        print(f"    wrote {p.name} ({p.stat().st_size / 1e3:.0f} KB) tiers {counts}")
    p = OUT / "literature_edges.json"
    p.write_text(json.dumps({"sources": sources, "edges": lit_edges}, separators=(",", ":")))
    print(f"    wrote {p.name} ({p.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    sys.exit(main())
