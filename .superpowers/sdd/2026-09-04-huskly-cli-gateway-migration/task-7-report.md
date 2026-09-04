# Task 7 report

## Status

Complete.

## Commits

- `e48602f` — `feat: persist gateway order previews safely`
- follow-up pending for account-authority removal in preview wiring

## What changed

- Added `src/storage/privateJsonFile.ts`.
- Added descriptor-safe private JSON persistence.
- Enforced private directory mode `0700`.
- Enforced private file mode `0600`.
- Refused symlink, non-regular, and loose existing targets.
- Used exclusive temp creation.
- Synced the temp file before rename.
- Synced the directory after rename.
- Cleaned temp files on write failure without hiding the main error.
- Enforced bounded reads and strict versioned JSON schemas.
- Moved preview persistence to the new private JSON helper.
- Stored the canonical gateway combo intent and normalized preview result.
- Removed preview request `accountId` from `PreviewVerticalRequest` and `DerivativeComboPreviewRequest`.
- Removed preview-side account matching and preview validation context.
- Removed synthesized `selectedAccountId` compatibility state from preview diagnostics.
- Removed the CLI preview `--account` flag and stopped passing caller account authority into preview requests.
- Updated the legacy direct preview bridge to discover its required legacy account internally with `direct.getAccountId()`.
- Removed persisted account IDs, account digests, and caller `clientOrderId` values.
- Kept only the masked account display from diagnostics, when present.
- Kept preview validity at five minutes and rejected exactly at the expiry boundary.
- Stored rejected previews and kept preview as a non-submitting operation.
- Broke old persisted preview formats on purpose.
- Updated MCP preview input so it also stops accepting caller account authority.
- Updated preview rendering to handle a missing masked account display.

## Files changed

- `src/storage/privateJsonFile.ts`
- `test/storage/privateJsonFile.test.ts`
- `src/derivatives/derivativePreview.ts`
- `src/derivatives/derivativePreviewService.ts`
- `src/derivatives/derivativeClient.ts`
- `src/derivatives/derivativeExecution.ts`
- `src/derivatives/derivativeExecutionService.ts`
- `src/derivatives/ibkrDerivativeAdapter.ts`
- `src/cli/derivatives.ts`
- `src/mcp/tools/derivatives.ts`
- `test/derivatives/derivativePreviewService.test.ts`
- `test/derivatives/derivativeExecutionService.test.ts`
- `test/derivatives/ibkrDerivativeAdapter.test.ts`
- `test/cli/derivatives.test.ts`

## Verification

### Required RED step

- Ran `npm test -- test/storage/privateJsonFile.test.ts test/derivatives/derivativePreviewService.test.ts` before implementation.
- Result: failed as expected because `src/storage/privateJsonFile.ts` did not exist and the old preview behavior still expected account-bound validation.

### Final verification

- `npm test -- test/storage/privateJsonFile.test.ts test/derivatives/derivativePreviewService.test.ts` ✅
- `npm test -- test/derivatives/*.test.ts` ✅
- `npm run lint` ✅
- `npm run typecheck` ✅

## Self-review

- Re-checked the diff after the parent feedback.
- Verified that preview requests now carry no `accountId` and no `clientOrderId`.
- Verified that diagnostics account mismatches no longer block preview creation.
- Verified that CLI preview command registration contains no `--account` option.
- Re-ran focused tests, derivative tests, lint, and typecheck after the last edits.

## Concerns

- None for Task 7 scope.
