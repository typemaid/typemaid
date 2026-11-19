#!/usr/bin/env bash
# Runs the same program on every runtime found on this machine, then checks that the core
# also works where there is no Node at all (browsers, edge workers).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bun run build >/dev/null 2>&1 || { echo "build failed"; exit 1; }
status=0
try() { "$@" scripts/runtime-check.mjs 2>&1 | tail -3 || status=1; }
command -v bun >/dev/null && try bun
seen=""
for node in "$HOME"/.nvm/versions/node/v2[2-9]*/bin/node "$(command -v node || true)"; do
  [ -x "$node" ] || continue
  version="$("$node" -v)"
  case " $seen " in *" $version "*) continue ;; esac
  seen="$seen $version"
  try "$node"
done
command -v deno >/dev/null && try deno run --allow-all || echo "skip deno (not installed)"
bun scripts/edge-check.ts || status=1
exit $status
