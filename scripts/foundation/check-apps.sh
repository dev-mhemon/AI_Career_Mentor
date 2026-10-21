#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/foundation/record-command.mjs backend-lint npm --prefix backend run lint
node scripts/foundation/record-command.mjs backend-unit npm --prefix backend test
node scripts/foundation/record-command.mjs backend-build npm --prefix backend run build
node scripts/foundation/record-command.mjs backend-e2e node scripts/foundation/local.mjs backend-e2e
node scripts/foundation/record-command.mjs backend-http node scripts/foundation/application-check.mjs
node scripts/foundation/record-command.mjs frontend-lint npm --prefix frontend run lint
node scripts/foundation/record-command.mjs frontend-unit npm --prefix frontend test
node scripts/foundation/record-command.mjs frontend-build node scripts/foundation/local.mjs frontend-build
node scripts/foundation/record-command.mjs frontend-http node scripts/foundation/frontend-check.mjs
