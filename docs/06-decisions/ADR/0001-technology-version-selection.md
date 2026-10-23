# Technology Version Selection Decision

> Historical selection and verification narrative retained below. DOC-01 observed frontend/package.json and its committed lockfile selecting Next.js 16.3.8 after implementation commit 114afc91bea651ff32e50dd7f3b372491037a7b7, merged in source HEAD 74e2f2c8975751d9c1545917ed7fa81be50d4400. The original 16.3.7 entry is preserved as provenance, not the current manifest value. npm/Vitest remain the recorded scoped exception to older pnpm/Jest examples. The verification claims below are historical and do not supply current-HEAD results; use the [current audit](../../07-planning/phase-1-audit.md) and [DOC-01 record](../../07-planning/current-phase/documentation-alignment/DOC-01.md). No dependency or upgrade policy is changed by this note.

## Decision

List the selected versions:

- Node.js: >=24.0.0 (v24 LTS)
- npm: >=10.0.0 (Currently using v11.17.0)
- Next.js: 16.3.7
- NestJS: ^12.0.1
- TypeScript: ^6.0.2
- Testing tools: Vitest ^5.0.3

## Reasoning

- **Why this runtime version was selected**: Node.js 24 is the active Long Term Support (LTS) release, providing security, extended stability, and performance features required for modern applications.
- **Why these framework versions were chosen**: Next.js 16 and NestJS 12 are the latest major releases that fully support Node 24 and newer ECMAScript standards, enabling high performance and long-term maintainability.
- **Compatibility considerations**: Using matching TypeScript (^6.0.2) and testing tool versions (Vitest ^5.0.3) across both frontend and backend prevents context-switching friction and dependency conflicts.
- **Production stability considerations**: Fixing framework versions and standardizing on a single stable Node LTS guarantees consistent behavior across development, continuous integration, and production environments.

## Verification

- **Frontend CI status**: Verified. Passed `npm ci`, `npm run lint`, `npm run test`, and `npm run build` without issues under Node 24.
- **Backend CI status**: Verified. Passed `npm ci`, `npm run lint`, `npm run test`, and `npm run build` without issues under Node 24.
- **Build/test verification result**: Fully compliant. Tests and builds complete successfully with all warnings resolved or accounted for.

## Future Upgrade Policy

- **How future version upgrades should be evaluated**: Upgrades must only occur if there is a demonstrated security need, an explicitly required new feature, or an approaching End-Of-Life (EOL) date.
- **Avoid upgrading dependencies without compatibility checks**: No major package should be upgraded without thoroughly verifying compatibility with the existing Node.js LTS version, Next.js, and NestJS runtimes. All proposed upgrades require a full CI pipeline verification and an ADR review before merging.
