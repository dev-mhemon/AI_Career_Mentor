#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node -e 'if(Number(process.versions.node.split(".")[0])<24)throw Error("Node >=24 required")'
python3 scripts/foundation/verify-baseline.py
npm ci --prefix backend --cache .local/npm-cache
npm ci --prefix frontend --cache .local/npm-cache
