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
reviewed_sql=json.loads((b/'review/sql-export-manifest.json').read_text())['files']
for f in reviewed_sql:
 if f['kind'] in ('forward','down','tests'):
  check(root/f['path'],f);counts[f['kind']]=counts.get(f['kind'],0)+1
if len(manifest['files'])!=179 or counts!={'forward':21,'down':21,'tests':8}:
 raise SystemExit('Count mismatch: '+str(counts))
print('PASS: 179 reviewed entries; integrated SQL 21 forward / 21 rollback / 8 test files, byte-identical')

extensions=[
 {'kind':'forward','path':'supabase/migrations/022_session_approval_gate.sql','bytes':7443,'sha256':'f9952effc3a2c6318366bb94cee551535b39e5d83a4d305922f0ead3816a7326'},
 {'kind':'down','path':'supabase/rollbacks/022_session_approval_gate_down.sql','bytes':4412,'sha256':'94f1b652e26c2eeb7e49d7e83d2e933aac44da8194230f147433a1e69d14d481'},
]
for f in extensions: check(root/f['path'],f)
def paths(folder):
 return {str(p.relative_to(root)).replace('\\','/') for p in (root/folder).glob('*.sql')}
for kind,folder in [('forward','supabase/migrations'),('down','supabase/rollbacks'),('tests','supabase/tests/database')]:
 expected={f['path'] for f in reviewed_sql if f['kind']==kind}|{f['path'] for f in extensions if f['kind']==kind}
 actual=paths(folder)
 if actual!=expected:
  raise SystemExit(f'SQL directory inventory mismatch for {kind}: unexpected={sorted(actual-expected)}, missing={sorted(expected-actual)}')
print('PASS: scoped SQL extension 022 forward / rollback registered; no unregistered SQL inventory')
