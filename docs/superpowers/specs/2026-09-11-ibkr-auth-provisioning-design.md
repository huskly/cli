# IBKR Gateway Credential Provisioning Design

## Purpose

Add `huskly-cli auth ibkr` to provision and validate the two machine credentials used by the CLI installation.

The public CLI is a client of a restricted remote provisioning API. It does not define or expose the server authorization policy. Users without server authorization receive a generic error.

## Scope

The command provisions both runtime files:

- `~/.config/huskly/ibkr-gateway-cli.json`
- `~/.config/huskly/ibkr-gateway-mcp.json`

Both credentials request `ibkr:read-write` access. This feature does not add direct IBKR access, a local authorization selector, or general self-service access.

## Security boundary

The remote service authenticates the existing CLI session and decides whether provisioning is permitted. The public CLI does not contain administrator usernames, email addresses, private hostnames, or a copy of the authorization rule.

A missing or expired session produces an authentication error. A user without permission receives a generic authorization error. The API returns each plaintext machine secret once. The CLI must not log or print session tokens, client secrets, Basic authorization values, bearer tokens, account identities, or remote response bodies.

## Command interface

```bash
huskly-cli auth ibkr
huskly-cli auth ibkr --replace
```

The command reuses an active Huskly CLI session. If no active session exists, it starts the existing browser device-login flow and continues after login succeeds.

Before any remote rotation, the command checks the target directory and both target paths. It rejects symbolic links, non-regular targets, files not owned by the current user, and unsafe file modes.

If either target exists, an interactive terminal asks once whether to rotate and replace both credentials. The prompt states that rotation revokes the current credentials immediately. A non-interactive invocation fails unless `--replace` is present. Declining the prompt makes no remote request and changes no file.

## Public API contract

The CLI calls:

```text
POST /api/v1/cli/ibkr-credentials/rotate
```

A first-use request omits both current client IDs:

```json
{
  "credentials": {
    "cli": {},
    "mcp": {}
  }
}
```

A replacement request supplies `currentClientId` for each existing file. The successful response contains deployment-controlled HTTPS URLs and separate one-time credentials:

```json
{
  "gatewayUrl": "https://gateway.example",
  "tokenUrl": "https://finance.example/api/v1/machine/token",
  "credentials": {
    "cli": {
      "clientId": "synthetic-cli-client-id",
      "clientSecret": "synthetic-cli-client-secret"
    },
    "mcp": {
      "clientId": "synthetic-mcp-client-id",
      "clientSecret": "synthetic-mcp-client-secret"
    }
  }
}
```

The CLI accepts only the exact response shape. It requires absolute HTTPS URLs without user information or fragments. It bounds response reads, rejects redirects, and maps remote failures to fixed redacted messages.

## Local installation

After a successful response, the command:

1. Builds one exact four-field configuration for each runtime.
2. Creates the private configuration directory with mode `0700` when needed.
3. Writes both configurations to unpredictable same-directory temporary files with mode `0600`.
4. Flushes and closes both temporary files before replacing either target.
5. Renames each temporary file over its target.
6. Validates both installed credentials.

Each installed file has exactly these fields:

```json
{
  "gatewayUrl": "https://gateway.example",
  "tokenUrl": "https://finance.example/api/v1/machine/token",
  "clientId": "synthetic-client-id",
  "clientSecret": "synthetic-client-secret"
}
```

Two file renames cannot form one filesystem transaction. Staging and closing both files before the first rename reduces the split-install failure window.

## Validation

Each credential must prove all of these conditions:

- Machine-token exchange succeeds.
- The returned scope is exactly `ibkr:read-write`.
- Gateway liveness succeeds.
- The gateway API version matches the pinned client.
- Diagnostics report an authenticated IBKR session.
- Diagnostics report an active broker connection.
- Diagnostics report a verified account.

Only machine-token exchange uses bounded retry. Gateway calls are not retried.

## Failure handling

Failures before the provisioning request leave local files unchanged.

After a successful remote rotation, the new credentials are authoritative. A local installation or validation failure must state that rotation succeeded, old credentials must not be restored, and the operator must fix readiness or rerun:

```bash
huskly-cli auth ibkr --replace
```

Errors identify only a safe phase and runtime. They do not include credentials, tokens, account values, response bodies, or raw transport messages.

## Public repository requirements

Source, tests, fixtures, documentation, help, and errors use synthetic identities and hosts. They do not contain private authorization details, administrator identity data, private deployment hosts, realistic credentials, or server implementation paths.

## Testing

The public CLI test suite covers:

- strict provisioning request and response validation;
- authentication and authorization error mapping;
- first use and replacement confirmation;
- non-interactive `--replace` enforcement;
- unsafe path and permission rejection before network access;
- secure two-file staging, syncing, replacement, and cleanup;
- token scope and full gateway readiness validation;
- malformed stored sessions and lazy native keychain loading;
- fixed post-rotation recovery guidance and secret redaction; and
- a real-layer integration test with temporary files and routed synthetic HTTP responses.

## Documentation

The README presents `huskly-cli auth ibkr` as the normal setup path. Manual four-field configuration remains available only as an operator recovery procedure.
