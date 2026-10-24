# Shared agent execution and handoff workflow

This is the single project procedure for Codex and Google Antigravity. Read [AGENTS.md](../../AGENTS.md), [START-HERE](START-HERE.md), applicable scoped instructions and [source authority](source-of-truth.md). Agent-specific skills/settings are not assumed shared. Find the current task and its handoff record through START-HERE; a receiving agent must compare that record with actual Git state.

## 1. Task intake and source identity

Record the goal, observable acceptance criteria, allowed files/actions, exclusions, authoritative sections, dependencies and relevant checks before editing. An earlier task's approval is not continuing permission to push, deploy or change scope.

Confirm the actual execution shell, root, branch, full HEAD and staged/unstaged/untracked status. Preserve owner changes and state whether the task includes them. On a clean checkout, use a dedicated branch for authorized writing work; do not switch over unrelated changes or reset to an old report's SHA.

For Windows agent commands, prefer explicitly selected installed Git Bash. The visible VS Code terminal does not identify an agent's command runner. A PowerShell launcher may start the actual Git Bash executable; a generic bash command may instead select WSL. In Bash, verify:

~~~bash
printf 'Bash %s\n' "$BASH_VERSION"
pwd -P
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git --no-optional-locks status --short --branch
~~~

Identify the launcher using its own shell's facilities before applying Bash syntax. If sandbox/shell startup fails, preserve a sanitized error and use an approved execution path; do not change global settings or assume the visible terminal fixes it. The native PowerShell service procedure remains in the [runbook](../09-operations/runbook.md).

## 2. Context selection

Use the [context map](context-map.md) to read relevant specification sections, existing implementation and tests first. Expand for dependent HTTP, domain, SQL, privacy or UX invariants. Read all nine complete documents only when task scope requires that breadth. Use public templates and code consumers for configuration, never credential stores or private runtime files.

A previous chat/handoff is a finding list, not authority or proof. Locate the repository task record and source/evidence paths so another agent can work without chat history.

## 3. Uncertainty and conflicts

Separate intended requirement, approved exception, observed behavior, execution and acceptance. Record contradictory source sections, actual source identity, assumptions, impact and the missing decision in [open issues](open-issues.md) and the task record. An approved scoped resolution applies only to its named scope.

Continue independent authorized work; block only work depending on an unresolved decision. Ask the owner when product/provider/security policy is genuinely undecided. Do not invent API fields, enum values, schema objects, provider choices or business rules. Code/spec mismatch does not authorize silent specification changes.

## 4. Implementation

Prefer small reviewable changes using established conventions and installed tooling. Document contract changes and approved deviations with provenance. Use test-first development where it helps behavioral/security correctness; do not require new tests that merely mirror prose edits or trivial changes.

Keep reviewed baseline/core sources, applied SQL and original suites frozen. Applied SQL defects need separately reviewed forward migrations. Do not install tools, mutate databases, change dependencies/workflows or broaden task scope merely to complete a documentation task.

## 5. Verification and evidence

Select checks for the actual behavior/security/integration risk. For documentation-only changes, inspect the verifier sources and run the existing read-only checks with the Python executable available in that environment. The examples below use python; resolve the actual executable first and substitute python3 only when available. Historical interpreter and command observations belong in the task record, not a permanent machine assumption.

~~~bash
python scripts/foundation/verify-baseline.py
python scripts/alignment/verify.py
git diff --check
git diff --cached --check
~~~

For application changes, select the relevant lint/unit/build/HTTP/regression checks from the runbook; broader checks need a reason based on the changed risk. Service or destructive DB checks require the task's authorization and positively identified disposable-project safeguards. Do not weaken assertions, update protected hashes or fake outputs to obtain PASS.

For every check record command, exit status, scope, environment, source identity and artifact pointer. Preserve failed results; distinguish documentation defects from shell/network/sandbox limitations. Report skipped and not-run checks separately.

- SPECIFIED: a named authoritative contract exists.
- IMPLEMENTED: a named source revision contains the behavior.
- EXECUTED: a command ran against identified committed source or an identified uncommitted worktree with a result.
- ACCEPTED: a named reviewer/owner gate explicitly accepted the stated scope.

A clean commit SHA does not identify subsequent worktree edits. For uncommitted work, record base HEAD plus branch, changed/untracked paths and a diff/content snapshot or fingerprint where useful. Never relabel old execution as fresh execution. A build or test count does not prove every requirement.

## 6. Review

Inspect the full staged and unstaged diff, not only its summary. List and read new/untracked task files separately because ordinary git diff omits them. Check maintained Markdown links/source references, contradictory entry points, protected-source hashes and whether changed content contains private data.

Confirm the final allowed-file boundary and report material findings and remaining gates. A local diff delivery is not a commit, PR, deployment or owner acceptance.

## 7. Handoff and coordination

Maintain one current task record under docs/07-planning/current-phase/; point START-HERE to it. Include the actual checks and next concrete action. Historical task records remain historical; do not rewrite or relocate their evidence. On receipt, compare root/branch/HEAD/status, source links and worktree changes with the record before continuing.

Sequential handoffs are the default. Concurrent writers need separately authorized work, separate branches/worktrees, clear non-overlapping file ownership and an integration handoff. Launch additional agents only when explicitly authorized by the task or applicable instructions.

Use this compact template in the task record; do not create duplicate agent-specific templates:

~~~text
Task / goal / observable acceptance:
Status: delivery/checks; separate owner acceptance:
Allowed scope / exclusions:
Sources and scoped instructions / approved exceptions:
Root / branch / base / full HEAD:
Committed source versus owner/task worktree changes:
Changed files and decisions:
Completed work / findings:
Checks: command | exit | environment/scope | tested identity | artifact:
Failed / skipped / not-run checks:
Protected-source and full-diff review:
Blockers / unresolved owner decisions:
Next action: inputs | deliverables | dependencies | acceptance:
~~~

### Documentation status lifecycle checklist

Use START-HERE to navigate to the current maintenance/task record; the source register retains requirement authority. Update affected status assertions rather than every document after every merge. Preserve dated snapshots and earlier pending evidence, using current summaries or explicit superseding addenda.

- The task author maintains affected current summaries during implementation and review handoff, distinguishing the current maintenance task, latest merged implementation and next separately authorized candidate.
- The reviewer manually compares README, START-HERE and affected governance/planning/operations summaries with the latest task evidence and actual revision. Check SPECIFIED, IMPLEMENTED, EXECUTED and ACCEPTED separately, including open decisions, scoped acceptance and integration limitations. Link/hash checks alone do not establish semantic status consistency.
- Before merge, the merge operator identifies an authorized post-merge documentation updater. This checklist does not authorize a merge or confer standing permission to edit, commit, push or change GitHub state.
- Before dependent handoff, that updater verifies the actual merged head/merge SHA and separate PR-head/post-merge CI identities and results, then reconciles the existing record and affected current summaries. Record unavailable or pending evidence honestly; never predict post-merge success before merge or relabel local checks as hosted CI.
- Every future task verifies actual revision, working-tree state and status before relying on maintained prose. Retain historical records, source authority and unresolved provider/release gates.

Include this manual semantic-status review and its remaining gates in the existing handoff record. Documentation maintenance completion may be reported through normal delivery evidence; do not create recursive documentation-only follow-ups unless another factual correction is necessary.

## 8. Tool portability and privacy

Inspect existing repository/global instruction entry points for conflicts without changing user-global configuration or reading credential/settings stores. A tool-specific bootstrap, if observed necessary, should only point to shared guidance. Do not maintain independent Codex/Gemini rule copies, claim a rule was loaded without observation, or equate PATH lookup failure with an absent installation.

Recheck shell, interpreter and agent discovery in the receiving environment. Historical machine observations are preserved in the [DOC-01 record](../07-planning/current-phase/documentation-alignment/DOC-01.md#current-observations-versus-historical-claims); they are not durable machine guarantees. An operator can explicitly open root AGENTS, START-HERE, this workflow and the task record selected by START-HERE for either agent.

Use the [config register](config-register.md) for names and visibility. Never print tokens, read credential stores, dump process environments or copy private logs/runtime configuration into evidence. Do not treat .aiignore or another AI ignore file as a universal protection mechanism. No actual rule loading, provider approval or release acceptance is inferred from a file merely existing.
