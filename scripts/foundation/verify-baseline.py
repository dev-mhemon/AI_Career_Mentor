#!/usr/bin/env python3
"""Verify immutable handoff and exact integrated SQL; never rewrite a manifest."""
import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parents[2]
b=root/'planning/reviewed-baseline'
manifest=json.loads((b/'review/package-manifest.json').read_text())
def check(path,entry):
 data=path.read_bytes()
 if len(data)!=entry['bytes'] or hashlib.sha256(data).hexdigest()!=entry['sha256']:
  raise SystemExit('Hash mismatch: '+str(path.relative_to(root)))
for f in manifest['files']: check(b/f['path'],f)
counts={}
for f in json.loads((b/'review/sql-export-manifest.json').read_text())['files']:
 if f['kind'] in ('forward','down','tests'):
  check(root/f['path'],f);counts[f['kind']]=counts.get(f['kind'],0)+1
assert len(manifest['files'])==179 and counts=={'forward':21,'down':21,'tests':8},counts
print('PASS: 179 reviewed entries; integrated SQL 21 forward / 21 rollback / 8 test files, byte-identical')

assert len(list((root/"supabase/migrations").glob("*.sql"))) == 21
assert len(list((root/"supabase/rollbacks").glob("*.sql"))) == 21
assert len(list((root/"supabase/tests/database").glob("*.sql"))) == 8
