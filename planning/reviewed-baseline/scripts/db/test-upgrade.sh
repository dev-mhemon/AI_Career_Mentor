#!/usr/bin/env bash
set -euo pipefail
: "${FRESH_DB_URL:?Set disposable fresh database URL}"
: "${UPGRADED_DB_URL:?Set disposable upgraded database URL}"
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
for task_kind in fresh upgraded; do
  if [[ "$task_kind" == fresh ]]; then
    task_db_url=$FRESH_DB_URL
  else
    task_db_url=$UPGRADED_DB_URL
  fi
  pg_dump --schema-only --no-owner --no-comments \
    --schema=public --schema=private --schema=extensions "$task_db_url" \
    > "$task_tmp/$task_kind.raw.sql"
  sed '/^\\restrict /d; /^\\unrestrict /d; /^--/d; /^[[:space:]]*$/d' \
    "$task_tmp/$task_kind.raw.sql" > "$task_tmp/$task_kind.sql"
done
diff -u "$task_tmp/fresh.sql" "$task_tmp/upgraded.sql"
printf '%s\n' 'Schema/privilege parity passed; run pgTAP on both databases separately.'
