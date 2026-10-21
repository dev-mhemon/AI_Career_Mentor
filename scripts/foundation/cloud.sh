#!/usr/bin/env bash
# Saved cloud configuration; credentials remain in private generated JSON files.
set -euo pipefail
cd "$(dirname "$0")/../.."
export MENTOR_LOCAL_DIR=/workspace/.mentor-foundation
export SUPABASE_BIN=/workspace/.mentor-tools/node_modules/.bin/supabase
export SUPABASE_HOME=/workspace/.mentor-tools/supabase-state
case "${1:-start}" in
  database-check) node scripts/foundation/database-check.mjs --disposable ;;
  application-check) node scripts/foundation/application-check.mjs ;;
  frontend-check) node scripts/foundation/frontend-check.mjs ;;
  *) node scripts/foundation/local.mjs "${1:-start}" ;;
esac
