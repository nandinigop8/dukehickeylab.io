#!/usr/bin/env bash
# Serve the site locally (works in both layouts: analysis workspace, or the
# website repo where the site sits at the repo root).
#
#   ./serve_local.sh            # http://127.0.0.1:8000/...
#   ./serve_local.sh 8080       # custom port
#
# Binds to 127.0.0.1 only. Browsers block fetch() from file:// URLs, so the
# pages must be opened through this server, not by double-clicking them.
set -euo pipefail

PORT="${1:-8000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -d "${SCRIPT_DIR}/../site" ]]; then           # analysis workspace
    ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
    URL_PATH="local_host_development/site/"
else                                                # website repo
    ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
    URL_PATH=""
fi

command -v python3 >/dev/null || { echo "ERROR: python3 not found." >&2; exit 1; }
[[ -f "${ROOT}/${URL_PATH}index.html" ]] || { echo "ERROR: no index.html under ${ROOT}/${URL_PATH}" >&2; exit 1; }

echo "Serving ${ROOT}"
echo "ASTRAEA: http://127.0.0.1:${PORT}/${URL_PATH}   (Ctrl+C to stop)"
exec python3 -m http.server "${PORT}" --bind 127.0.0.1 --directory "${ROOT}"
