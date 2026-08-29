#!/bin/sh
# Start the pinned-alpha local profile after applying the UTC default route.
# Provider catalogs and capacities remain in the DSH profile/settings layer.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DSH_ROOT=${DSH_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/../../../.." && pwd)}
DSH_HOME=${DSH_HOME:-"$HOME/.dsh"}
DSH_PROFILE=${DSH_PROFILE:-tod}
DSH_PORT=${DSH_PORT:-3080}
PYTHON=${PYTHON:-python3}

"$PYTHON" "$SCRIPT_DIR/tod.py" --home "$DSH_HOME"
cd "$DSH_ROOT"

# The local credential provider gives inherited environment variables higher
# precedence than the managed DSH home. Remove only known stale DSH exports
# from this child process; the parent shell remains unchanged.
exec env -u DEEPSEEK_API_KEY -u ARK_API_KEY -u ARK_PLAN_API_KEY \
  -u MODELFLARE_API_KEY -u GMI_SERVING_API_KEY \
  pnpm dsh --profile "$DSH_PROFILE" --port "$DSH_PORT" "$@"
