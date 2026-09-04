# Task 1 report

## Scope

Implement Task 1 only in `/home/felipecsl/prj/huskly-cli/.worktrees/issue-17-gateway-migration`.

## Changes

- Added `@huskly/ibkr-gateway-client@0.5.0` with npm and committed `package-lock.json`.
- Removed the stale `yarn.lock` so npm lock state is authoritative.
- Tightened tracked worktree ignore entry to `/.worktrees/`.
- Added `src/gateway/gatewayConfig.ts` with:
  - `loadGatewayConfig(options): Promise<GatewayConfig>`.
  - runtime-specific default paths and env-path overrides.
  - `open(path, O_RDONLY | O_NOFOLLOW)` loading.
  - descriptor-based `stat()` checks for regular file, owner uid, exact `0600` mode, and bounded reads.
  - strict Zod parsing for the exact four-field JSON object.
  - URL validation that rejects credentials, fragments, and non-HTTPS URLs, except explicit loopback HTTP when `allowHttpLoopback` is true.
- Added `test/gateway/gatewayConfig.test.ts` with coverage for:
  - CLI and MCP default paths.
  - CLI and MCP runtime-specific override paths.
  - malformed JSON.
  - missing, unknown, empty, and unbounded fields.
  - file size over 16 KiB.
  - owner mismatch.
  - every mode outside `0600`.
  - non-regular file rejection.
  - symlink rejection.
  - HTTPS enforcement.
  - URL credentials and fragment rejection.
  - allowed loopback HTTP hosts only.

## Verification run

### Install and baseline

- `npm install --save-exact @huskly/ibkr-gateway-client@0.5.0` ✅
- `npm test` ✅

### Task 1 red step

- `npm test -- test/gateway/gatewayConfig.test.ts` ✅ RED before implementation with `ERR_MODULE_NOT_FOUND` for `src/gateway/gatewayConfig.ts`.

### Task 1 verification after implementation

- `npm exec eslint -- src/gateway/gatewayConfig.ts test/gateway/gatewayConfig.test.ts` ✅
- `npm test -- test/gateway/gatewayConfig.test.ts` ✅
- `npm run typecheck` ❌

## Typecheck concern

`npm run typecheck` still fails in pre-existing files outside Task 1:

- `src/brokers/ibkrBrokerAdapter.ts(44,34)`
- `src/derivatives/derivativeClient.ts(33,38)`

These failures are unrelated to the new gateway config loader files. I did not change those files because the task brief restricted this task to Task 1 only.

## Self-review notes

- Confirmed the descriptor-safe loader keeps checks and reads on the opened file handle.
- Confirmed tests cover the strict mode matrix and loopback URL allowlist.
- Confirmed no secret value is logged or serialized by the loader logic.
