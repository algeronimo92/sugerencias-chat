#!/usr/bin/env sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SPEC_DIR=$(mktemp -d)
trap 'rm -rf "$SPEC_DIR"' EXIT

(cd "$ROOT/backend" && python -m scripts.export_openapi "$SPEC_DIR/openapi.json")
(cd "$ROOT/frontend" && npx --yes openapi-typescript@7.13.0 "$SPEC_DIR/openapi.json" -o src/api/schema.d.ts)
