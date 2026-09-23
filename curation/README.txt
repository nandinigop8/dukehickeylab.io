CURATION -- implantation gene notes
===================================
implantation_gene_notes.csv holds the short "Role in implantation" notes
shown when a gene is clicked on the site. One row per gene:

  gene       gene symbol exactly as in the network
  note       1-3 sentences, plain language
  pmids      semicolon-separated PubMed IDs supporting the note
  status     draft | reviewed
  reviewer   name/initials of the lab member who checked it (when reviewed)

RULES (enforced by script/build_gene_annotations.py -- the build stops if broken)
  - Every PMID must already be linked to THAT gene in NCBI (a GeneRIF or an
    NCBI Gene -> PubMed link matching the implantation/decidua query).
    You cannot cite a paper NCBI does not associate with the gene.
  - status must be "draft" or "reviewed".

REVIEW WORKFLOW (for the lab)
  1. Open the site, click the gene, read the note and its cited papers.
  2. If correct: set status=reviewed and fill reviewer. If not: edit the
     note (and pmids), keep status=draft until checked.
  3. Rebuild + validate from Nandini_Website/:
       python3 local_host_development/script/build_gene_annotations.py
       python3 local_host_development/script/validate_site.py stromal
  The site shows "Draft - pending lab review" until status=reviewed.

As of 2026-09-19: 36 notes, all status=draft (written by Claude from the
retrieved GeneRIFs/papers; each citation traced by the build check). Genes
without a note show the raw NCBI GeneRIF statements, or -- when there is no
implantation literature -- a "Novel candidate" message for network drivers.
