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
 {'kind':'forward','path':'supabase/migrations/024_session_revocation.sql','bytes':2412,'sha256':'a197b94df15cb7c54edd8d784abfc7bc38e17d5c63ebeea41e576e2daa21f102'},
 {'kind':'down','path':'supabase/rollbacks/024_session_revocation_down.sql','bytes':2309,'sha256':'a8a1aad7248a438216c909b5c61e8ca57a4e72f623d6ee139d2c2aa1a097e79a'},
 {'kind':'forward','path':'supabase/migrations/025_seed_skills_catalog.sql','bytes':11069,'sha256':'1791091f42c63b0676109b431a8b6d1d360a8f636614bc56ca4512a60dfd5f56'},
 {'kind':'down','path':'supabase/rollbacks/025_seed_skills_catalog_down.sql','bytes':1619,'sha256':'acc30e948b2f1d1e70d382ec7681262912fb129cfb92fdd0b7427aceb0b3a52b'},
 {'kind':'forward','path':'supabase/migrations/026_seed_ai_prompts_and_synthetic_model.sql','bytes':3197,'sha256':'3a359ab23305e855f85479bb7791def3311e76b6a8032b00e32d9c8e5c8c77dc'},
 {'kind':'down','path':'supabase/rollbacks/026_seed_ai_prompts_and_synthetic_model_down.sql','bytes':2687,'sha256':'a5af9325aece7ff7c3b84dd983c53aab334b77259d38b192d26f8c66bb83dead'},
 {'kind':'forward','path':'supabase/migrations/027_seed_gemini_real_user_models.sql','bytes':1837,'sha256':'017ad34f7a2c970a0514811b257cbc72a12b81c8b4c4e5720d0e15d6bc6b4555'},
 {'kind':'down','path':'supabase/rollbacks/027_seed_gemini_real_user_models_down.sql','bytes':890,'sha256':'0752897f7d7fa9bf3478a1d52c867c5ff100ee628b51bf64acf5262e69dab6d4'},
]
for f in extensions: check(root/f['path'],f)
def paths(folder):
 return {str(p.relative_to(root)).replace('\\','/') for p in (root/folder).glob('*.sql')}
for kind,folder in [('forward','supabase/migrations'),('down','supabase/rollbacks'),('tests','supabase/tests/database')]:
 expected={f['path'] for f in reviewed_sql if f['kind']==kind}|{f['path'] for f in extensions if f['kind']==kind}
 actual=paths(folder)
 if actual!=expected:
  raise SystemExit(f'SQL directory inventory mismatch for {kind}: unexpected={sorted(actual-expected)}, missing={sorted(expected-actual)}')
print('PASS: scoped SQL extensions 022, 023, 024, 025, 026 and 027 forward / rollback registered; no unregistered SQL inventory')
