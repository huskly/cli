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
- Follow-up fix: changed `requiredUid()` to use explicit narrowing and throw when `process.getuid?.()` is unavailable.

## Fresh verification

### `npm test -- test/gateway/gatewayConfig.test.ts`

- Exit: `0`
- Result: `74` tests passed, `0` failed.

### `npm exec eslint -- src/gateway/gatewayConfig.ts test/gateway/gatewayConfig.test.ts`

- Exit: `0`
- Result: no lint errors.

### `npm run typecheck`

- Exit: `2`
- Result: only the two expected pre-existing direct-client errors remain:

```text
src/brokers/ibkrBrokerAdapter.ts(44,34): error TS2345: Argument of type 'string[]' is not assignable to parameter of type 'readonly BrokerQuoteRequest[]'.
  Type 'string' is not assignable to type 'BrokerQuoteRequest'.
src/derivatives/derivativeClient.ts(33,38): error TS2345: Argument of type 'IbkrClient' is not assignable to parameter of type 'IbkrDerivativeDiscoveryApi'.
  Types of property 'previewDerivativeCombo' are incompatible.
    Type '(request: DerivativeComboPreviewRequest) => Promise<DerivativeComboPreviewResult>' is not assignable to type '(request: { accountId: string; legs: [{ contract: IbkrDerivativeContract; ratio: 1 | -1; }, { contract: IbkrDerivativeContract; ratio: 1 | -1; }]; ... 4 more ...; session: "REGULAR" | "OVERNIGHT"; }) => Promise<...>'.
      Types of parameters 'request' and 'request' are incompatible.
        Type '{ accountId: string; legs: [{ contract: IbkrDerivativeContract; ratio: 1 | -1; }, { contract: IbkrDerivativeContract; ratio: 1 | -1; }]; ... 4 more ...; session: "REGULAR" | "OVERNIGHT"; }' is not assignable to type 'DerivativeComboPreviewRequest'.
          Type '{ accountId: string; legs: [{ contract: IbkrDerivativeContract; ratio: 1 | -1; }, { contract: IbkrDerivativeContract; ratio: 1 | -1; }]; ... 4 more ...; session: "REGULAR" | "OVERNIGHT"; }' is not assignable to type 'DerivativeComboOrderFields & { orderType: "LMT"; limit: number; stopPrice?: never; }'.
            Property 'orderType' is missing in type '{ accountId: string; legs: [{ contract: IbkrDerivativeContract; ratio: 1 | -1; }, { contract: IbkrDerivativeContract; ratio: 1 | -1; }]; ... 4 more ...; session: "REGULAR" | "OVERNIGHT"; }' but required in type '{ orderType: "LMT"; limit: number; stopPrice?: never; }'.
```

## Self-review notes

- Confirmed the descriptor-safe loader keeps checks and reads on the opened file handle.
- Confirmed tests cover the strict mode matrix and loopback URL allowlist.
- Confirmed no secret value is logged or serialized by the loader logic.
- Confirmed the follow-up helper fix stays inside Task 1 scope.
