# ADR 0001: Runtime Version Selection

## Context
The project requires alignment of technology versions prior to initiating Phase 1 development. Diverse versions were present across different configurations (Node 20 in frontend/GitHub Actions, Node 24 in backend definitions), which could cause inconsistencies in development, CI, and production environments.

## Decision
We have decided to use **Node.js 24 LTS** as the standard project runtime across the entire monorepo.

## Why Node 24 LTS
- **Long Term Support (LTS)**: Node.js 24 LTS provides extended stability, security updates, and performance improvements, minimizing the need for immediate future migrations.
- **Modern JavaScript Capabilities**: Provides native support for newer ECMAScript features which benefits our modern stack (Next.js 14/16, NestJS 12).
- **Ecosystem Compatibility**: Validated against our core tools (Next.js, NestJS, TypeScript, Testing tools), which fully support Node 24.

## Updated Versions
To align with Node 24, the following updates have been made:
1. **Frontend**:
   - Upgraded `@types/node` from `^20` to `^24.19.0`.
   - Added `"engines": { "node": ">=24.0.0" }` to `package.json`.
2. **Backend**:
   - Maintained `@types/node` at `^24.0.0`.
   - Added `"engines": { "node": ">=24.0.0" }` to `package.json`.
3. **CI/CD (`.github/workflows/ci.yml`)**:
   - Updated GitHub Actions `setup-node` version from `'20'` to `'24'` for both frontend and backend workflows.
4. **Documentation (`README.md`)**:
   - Updated setup instructions to reflect Node.js (v24 or higher) requirement.
5. **Framework/Tooling Consistency**:
   - Aligned `typescript` to `^6.0.2` across both `frontend` and `backend`.
   - Aligned `vitest` to `^5.0.3` across both `frontend` and `backend`.
6. **Lock Files**:
   - Updated `package-lock.json` files for consistent dependency resolutions under Node 24 and aligned tool versions.

## Compatibility Verification
Compatibility across the stack has been successfully verified:
- **Frontend Check**: Passed `npm ci`, `npm run lint`, `npm run test`, and `npm run build` without issues. Next.js 16 and Vitest correctly compile and pass assertions on Node 24.
- **Backend Check**: Passed `npm ci`, `npm run lint`, `npm run test`, and `npm run build` without issues. NestJS 12 and TypeScript build pipelines function correctly with Node 24 typings.
- All testing and linting tools (`eslint`, `vitest`) are fully compatible with Node 24.
