#!/usr/bin/env python3
"""Deterministic adoption/link checks; never rewrite approved hashes or source text."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
manifest = json.loads((ROOT / 'docs/00-governance/source-manifest.json').read_text())
assert {entry['id'] for entry in manifest['documents']} == {f'C0{i}' for i in range(1, 10)}
for entry in manifest['documents']:
    active = ROOT / entry['destination']
    data = active.read_bytes()
    assert len(data) == entry['bytes'], entry['destination']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['destination']
    assert (ROOT / entry['historical_baseline']).read_bytes() == data, entry['id']
    # The index/blob must also preserve source bytes after staging/commit.
    indexed = subprocess.run(['git', 'show', ':' + entry['destination']], cwd=ROOT, capture_output=True)
    if indexed.returncode == 0:
        assert indexed.stdout == data, 'Git index bytes differ: ' + entry['id']
subprocess.run(['python3', str(ROOT / 'scripts/foundation/verify-baseline.py')], check=True, cwd=ROOT)
maintained = [ROOT/'README.md', ROOT/'AGENTS.md', ROOT/'backend/README.md', ROOT/'frontend/README.md']
for folder in ['00-governance', '06-decisions', '07-planning', '09-operations']:
    maintained += [p for p in (ROOT/'docs'/folder).rglob('*.md') if '/current-phase/foundation/' not in str(p)]
failures = []
for doc in maintained:
    # Only actual Markdown links, not path-looking code or external live links.
    text = re.sub(r'```.*?```', '', doc.read_text(), flags=re.S)
    for target in re.findall(r'\]\(([^\s)]+)(?:\s+"[^"]*")?\)', text):
        target = unquote(target.strip('<>').split('#')[0])
        if not target or re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:', target):
            continue
        resolved = (doc.parent/target).resolve()
        if not resolved.is_relative_to(ROOT) or not resolved.exists():
            failures.append(f'{doc.relative_to(ROOT)} -> {target}')
assert not failures, '\n'.join(failures)
for name in ['supabase/migrations', 'supabase/rollbacks', 'supabase/tests/database']:
    assert (ROOT/name).is_dir()
assert not list((ROOT/'backend/src/migrations').glob('*.ts'))
print(f'PASS: 9 exact upload/index hashes; historical equality; {len(maintained)} maintained document link sources; baseline/SQL invariants')
