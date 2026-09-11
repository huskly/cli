# IBKR Gateway Authentication Provisioning Implementation Plan

**Goal:** Add a secure public CLI command that obtains two restricted remote credentials, installs them privately, and validates the complete gateway path.

**Architecture:** The CLI treats credential issuance and authorization as an external API contract. Local modules separate strict HTTP transport, private file installation, gateway validation, and command orchestration.

**Tech Stack:** TypeScript, Commander, Zod, `node:test`, and `@huskly/ibkr-gateway-client` 0.5.0.

**Spec:** `docs/superpowers/specs/2026-09-11-ibkr-auth-provisioning-design.md`

## Global constraints

- Keep server authorization policy and private implementation details outside this public repository.
- Use synthetic identities, hosts, tokens, and credentials in source, tests, and documentation.
- Provision separate CLI and MCP credentials with exact `ibkr:read-write` scope.
- Inspect local targets before authentication or remote rotation.
- Use directory mode `0700` and file mode `0600`.
- Keep installed JSON limited to `gatewayUrl`, `tokenUrl`, `clientId`, and `clientSecret`.
- Require HTTPS URLs without user information or fragments.
- Bound HTTP response reads and reject redirects.
- Retry only machine-token exchange.
- Never log or print credentials, session tokens, bearer tokens, account identities, or raw remote errors.

---

### Task 1: Add strict provisioning transport and token scope evidence

**Files:**

- Create: `src/auth/ibkrProvisioningClient.ts`
- Create: `test/auth/ibkrProvisioningClient.test.ts`
- Modify: `src/gateway/machineTokenProvider.ts`
- Modify: `test/gateway/machineTokenProvider.test.ts`
- Modify: `src/gateway/gatewayConfig.ts`
- Modify: `test/gateway/gatewayConfig.test.ts`

Implement one redirect-blocked `POST /api/v1/cli/ibkr-credentials/rotate` request. Send empty runtime objects on first use and `currentClientId` only for existing credentials. Validate every response level with strict schemas, enforce bounded reads and safe HTTPS URLs, and map status codes to fixed redacted messages.

Extend the token provider with:

```ts
export interface MachineTokenAccess {
  readonly token: string;
  readonly scope: string;
}

export interface MachineTokenProvider {
  getAccess(): Promise<MachineTokenAccess>;
  getToken(): Promise<string>;
}
```

Cache token, scope, and expiry together. Preserve single-flight refresh, early refresh, unexpired fallback, and the existing retry policy.

Verify strict request bodies, response schemas, bounds, URL policy, status mapping, redaction, token scope caching, refresh behavior, and compatibility with existing gateway transport tests.

---

### Task 2: Add secure two-file inspection and installation

**Files:**

- Create: `src/auth/ibkrCredentialFiles.ts`
- Create: `test/auth/ibkrCredentialFiles.test.ts`
- Modify: `src/gateway/gatewayConfig.ts`
- Modify: `test/gateway/gatewayConfig.test.ts`

Export shared path resolution and strict configuration parsing from the existing gateway configuration module.

Add inspection that returns both paths, safe current client IDs, and whether either target exists. Reject unsafe directories, wrong ownership, wrong modes, non-regular files, symbolic links, malformed JSON, unsafe URLs, and oversized files.

Stage both complete configurations before replacing either target. Use unpredictable same-directory temporary names, exclusive no-follow opens, mode `0600`, file sync, close, per-file rename, directory sync, and narrow cleanup. Do not restore old data after a partial replacement.

Verify behavior with real temporary directories plus an injected file-operation boundary for ordering and failure cases.

---

### Task 3: Add full gateway readiness validation

**Files:**

- Create: `src/auth/ibkrCredentialValidator.ts`
- Create: `test/auth/ibkrCredentialValidator.test.ts`

Add:

```ts
export async function validateIbkrCredential(
  runtime: GatewayRuntime,
  config: GatewayConfig,
  dependencies?: IbkrCredentialValidatorDependencies
): Promise<void>;
```

For each runtime, obtain token scope evidence, require `ibkr:read-write`, call gateway liveness once, rely on the generated client for version compatibility, and call diagnostics once. Require `authenticated`, `connected`, and `accountVerified` to be literal `true`.

Wrap every failure in a fixed message that contains only the runtime and safe phase. Do not attach raw causes or retry gateway calls.

Verify success order and independent failures for token scope, token exchange, liveness, API version, malformed diagnostics, authentication, connection, and account verification.

---

### Task 4: Orchestrate and register the auth command

**Files:**

- Modify: `src/auth/husklyDeviceAuth.ts`
- Create: `test/auth/husklyDeviceAuth.test.ts`
- Create: `src/auth/ibkrAuthCommand.ts`
- Create: `test/auth/ibkrAuthCommand.test.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/auth/cli.ts`

Export the canonical public API origin and add `getSessionToken()` that returns only a valid, future, bounded stored session. Clear malformed keychain values. Load the native keychain module lazily so injected tests and non-keychain imports do not require the host native library.

Add:

```ts
export async function runIbkrAuthCommand(
  options: { readonly replace: boolean },
  dependencies?: IbkrAuthCommandDependencies
): Promise<void>;
```

Run local preflight first. Reuse an active session or complete browser login. Confirm immediate replacement once in an interactive terminal. Require `--replace` for non-interactive replacement. Provision, install, validate CLI, validate MCP, and report success.

After remote rotation, installation and validation errors must state that old credentials are revoked and must not be restored. Provide safe recovery commands without including sensitive values.

Register:

```text
huskly-cli auth ibkr [--replace]
huskly-cli-auth ibkr [--replace]
```

Verify orchestration order, login fallback, confirmation values, non-interactive behavior, failure boundaries, recovery guidance, output redaction, help output, and one real-layer flow with temporary files and routed synthetic HTTP responses.

---

### Task 5: Document and verify the public feature

**Files:**

- Modify: `README.md`

Document the normal flow:

```bash
huskly-cli auth login
huskly-cli auth ibkr
huskly-cli broker doctor --broker ibkr --json
```

State that remote policy restricts provisioning, CLI and MCP credentials are separate read-write credentials, rotation is immediate, and non-interactive replacement requires `--replace`. Keep manual configuration under operator recovery.

Run:

```bash
yarn check
```

Require lint, formatting, typecheck, and all tests to pass. Inspect added public lines for personal identity data, private deployment hosts, realistic credentials, and private server implementation details.
