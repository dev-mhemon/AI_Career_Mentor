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
 {'kind':'forward','path':'supabase/migrations/022_session_approval_gate.sql','bytes':7753,'sha256':'f631ed91c11aecf0ab6a1f8e6dbfc85f0a13c0521e200bb7d361dd8d3d5d5088'},
 {'kind':'down','path':'supabase/rollbacks/022_session_approval_gate_down.sql','bytes':4412,'sha256':'94f1b652e26c2eeb7e49d7e83d2e933aac44da8194230f147433a1e69d14d481'},
 {'kind':'forward','path':'supabase/migrations/023_session_gate_hardening.sql','bytes':2272,'sha256':'708970f2632b8aea00f4c75a0025f1239937f48a8efd0ac9f890b484cc8be21e'},
 {'kind':'down','path':'supabase/rollbacks/023_session_gate_hardening_down.sql','bytes':1607,'sha256':'3739f58b79bc2968fc1908b089736a9428048d13697e556e60f10fe551231fe3'},
]
for f in extensions: check(root/f['path'],f)
def paths(folder):
 return {str(p.relative_to(root)).replace('\\','/') for p in (root/folder).glob('*.sql')}
for kind,folder in [('forward','supabase/migrations'),('down','supabase/rollbacks'),('tests','supabase/tests/database')]:
 expected={f['path'] for f in reviewed_sql if f['kind']==kind}|{f['path'] for f in extensions if f['kind']==kind}
 actual=paths(folder)
 if actual!=expected:
  raise SystemExit(f'SQL directory inventory mismatch for {kind}: unexpected={sorted(actual-expected)}, missing={sorted(expected-actual)}')
print('PASS: scoped SQL extensions 022 and 023 forward / rollback registered; no unregistered SQL inventory')
