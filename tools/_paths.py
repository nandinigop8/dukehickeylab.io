"""Where everything lives, in either of the two layouts we use.

1. Analysis workspace (this repo):
       <root>/data/<compartment>/*.csv          exported CellOracle results
       <root>/local_host_development/site/       the website
       <root>/local_host_development/script/     these scripts

2. Website repo (e.g. github.com/nandinigop8/dukehickeylab.io), where the site
   must sit at the repo root for GitHub Pages:
       <root>/index.html, atlas.html, data/      the website
       <root>/analysis_data/<compartment>/*.csv  exported CellOracle results
       <root>/tools/                             these scripts

Import and call: `from _paths import paths; P = paths(__file__)`.
"""
from pathlib import Path


def paths(script_file):
    here = Path(script_file).resolve()
    ws = here.parents[2] if len(here.parents) > 2 else here.parent
    if (ws / "local_host_development" / "site").is_dir():          # layout 1
        dev = ws / "local_host_development"
        return {
            "root": ws, "site": dev / "site", "site_data": dev / "site" / "data",
            "exports": ws / "data", "cache": dev / ".cache",
            "curation": dev / "curation", "docs": dev / "workflow",
            "url_path": "local_host_development/site/",
        }
    root = here.parents[1]                                          # layout 2
    return {
        "root": root, "site": root, "site_data": root / "data",
        "exports": root / "analysis_data", "cache": root / ".cache",
        "curation": root / "curation", "docs": root / "docs",
        "url_path": "",
    }
