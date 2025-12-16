# Huskly Device Authentication Flow

This document describes the OAuth 2.0 Device Authorization Grant flow used to authenticate CLI applications with [huskly.finance](https://huskly.finance). This pattern is similar to how GitHub CLI, Copilot CLI, and Claude Code handle authentication.

## Overview

The device authorization flow allows CLI tools to authenticate users without requiring them to paste tokens manually. Instead, users authorize the CLI through their browser while the CLI polls for completion.

```
┌─────────┐                              ┌─────────────────┐                    ┌─────────┐
│   CLI   │                              │ huskly.finance  │                    │ Browser │
└────┬────┘                              └────────┬────────┘                    └────┬────┘
     │                                            │                                  │
     │  1. POST /api/v1/cli/device/code           │                                  │
     │────────────────────────────────────────────>                                  │
     │                                            │                                  │
     │  { deviceCode, userCode, verificationUri } │                                  │
     │<────────────────────────────────────────────                                  │
     │                                            │                                  │
     │  2. Display userCode to user               │                                  │
     │  3. Open verificationUri in browser ───────────────────────────────────────────>
     │                                            │                                  │
     │                                            │  4. User enters userCode         │
     │                                            │<──────────────────────────────────
     │                                            │                                  │
     │                                            │  5. User authorizes CLI          │
     │                                            │<──────────────────────────────────
     │                                            │                                  │
     │  6. POST /api/v1/cli/device/poll           │                                  │
     │     { deviceCode }                         │                                  │
     │────────────────────────────────────────────>                                  │
     │                                            │                                  │
     │  { status: "authorized", sessionToken }    │                                  │
     │<────────────────────────────────────────────                                  │
     │                                            │                                  │
     │  7. Store sessionToken in OS keychain      │                                  │
     │                                            │                                  │
     │  8. GET /api/v1/cli/token                  │                                  │
     │     Authorization: Bearer <sessionToken>   │                                  │
     │────────────────────────────────────────────>                                  │
     │                                            │                                  │
     │  { accessToken }                           │                                  │
     │<────────────────────────────────────────────                                  │
     │                                            │                                  │
```

## High-Level Steps

### Step 1: Initiate Device Flow

**Request:**

```http
POST https://huskly.finance/api/v1/cli/device/code
Content-Type: application/json
```

**Response:**

```json
{
  "deviceCode": "abc123...", // Secret code for polling (do not display)
  "userCode": "ABCD-1234", // Code user enters in browser (display this)
  "verificationUri": "https://huskly.finance/device", // URL to open
  "expiresIn": 900, // Seconds until deviceCode expires
  "interval": 5 // Minimum seconds between poll requests
}
```

### Step 2: Direct User to Authorize

1. Display the `userCode` prominently to the user
2. Display (and optionally auto-open) the `verificationUri`
3. User visits the URL in their browser and enters the code
4. User completes OAuth authorization in the browser

### Step 3: Poll for Authorization

While waiting for user to complete browser authorization:

**Request:**

```http
POST https://huskly.finance/api/v1/cli/device/poll
Content-Type: application/json

{
  "deviceCode": "abc123..."
}
```

**Response (pending):**

```json
{
  "status": "pending"
}
```

**Response (success):**

```json
{
  "status": "authorized",
  "sessionToken": "eyJ..."
}
```

**Response (failure):**

```json
{
  "status": "denied",
  "error": "User denied the request"
}
```

```json
{
  "status": "expired"
}
```

### Step 4: Store Session Token

Once authorized, store the `sessionToken` securely using the OS keychain:

- **macOS**: Keychain
- **Windows**: Credential Manager
- **Linux**: libsecret (GNOME Keyring, KDE Wallet, etc.)

The [keytar](https://www.npmjs.com/package/keytar) library provides cross-platform support.

### Step 5: Exchange Session for Access Token

When making API calls, exchange the long-lived session token for a short-lived access token:

**Request:**

```http
GET https://huskly.finance/api/v1/cli/token
Authorization: Bearer <sessionToken>
```

**Response:**

```json
{
  "accessToken": "schwab_access_token_here"
}
```

## API Endpoints Summary

| Endpoint                  | Method | Description                             |
| ------------------------- | ------ | --------------------------------------- |
| `/api/v1/cli/device/code` | POST   | Initiate device authorization flow      |
| `/api/v1/cli/device/poll` | POST   | Poll for authorization completion       |
| `/api/v1/cli/token`       | GET    | Exchange session token for access token |

## Implementation Details

### Polling Strategy

- Start with the `interval` value from device code response
- On HTTP 429 (rate limited): double the interval (max 30 seconds)
- On network errors: double the interval and retry
- Stop polling when `expiresIn` seconds have elapsed

```typescript
let currentInterval = intervalSeconds * 1000;
const deadline = Date.now() + expiresInSeconds * 1000;

while (Date.now() < deadline) {
  await sleep(currentInterval);

  const response = await fetch(pollUrl, { method: "POST", body: { deviceCode } });

  if (response.status === 429) {
    currentInterval = Math.min(currentInterval * 2, 30000);
    continue;
  }

  const result = await response.json();
  if (result.status === "authorized") {
    return result.sessionToken;
  }
}
```

### Secure Storage

Session tokens should be stored in the OS keychain, not in plaintext files:

```typescript
import keytar from "keytar";

const SERVICE_NAME = "your-app-name";
const ACCOUNT_NAME = "huskly-session";

// Store
await keytar.setPassword(
  SERVICE_NAME,
  ACCOUNT_NAME,
  JSON.stringify({
    sessionToken: "...",
    expiresAt: "2025-01-10T00:00:00.000Z",
  })
);

// Retrieve
const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
const session = JSON.parse(stored);

// Delete (logout)
await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
```

### Token Lifecycle

| Token Type    | Lifespan    | Storage     | Purpose                 |
| ------------- | ----------- | ----------- | ----------------------- |
| Device Code   | ~15 minutes | Memory only | One-time auth handshake |
| Session Token | ~30 days    | OS Keychain | Persistent CLI auth     |
| Access Token  | Short-lived | Memory only | Actual API calls        |

## Integration Guide

To integrate this auth flow into another project:

### 1. Install Dependencies

```bash
npm install keytar open chalk ora
```

### 2. Implement the Auth Class

```typescript
class DeviceAuth {
  private baseUrl: string;

  constructor(baseUrl = "https://huskly.finance") {
    this.baseUrl = baseUrl;
  }

  async login(): Promise<void> {
    // 1. Get device code
    const deviceCode = await this.initiateDeviceFlow();

    // 2. Show user code and open browser
    console.log(`Visit: ${deviceCode.verificationUri}`);
    console.log(`Enter code: ${deviceCode.userCode}`);
    await open(deviceCode.verificationUri);

    // 3. Poll for completion
    const session = await this.pollForAuthorization(
      deviceCode.deviceCode,
      deviceCode.interval,
      deviceCode.expiresIn
    );

    // 4. Store session
    await this.storeSession(session);
  }

  async getAccessToken(): Promise<string | null> {
    const session = await this.getStoredSession();
    if (!session || new Date(session.expiresAt) <= new Date()) {
      return null;
    }

    const response = await fetch(`${this.baseUrl}/api/v1/cli/token`, {
      headers: { Authorization: `Bearer ${session.sessionToken}` },
    });

    const { accessToken } = await response.json();
    return accessToken;
  }
}
```

### 3. Add CLI Commands

```typescript
// auth login  - Run the login flow
// auth logout - Clear stored credentials
// auth status - Check if authenticated and session expiry
```

### 4. Protect API Calls

```typescript
const auth = new DeviceAuth();

async function makeApiCall() {
  const token = await auth.getAccessToken();

  if (!token) {
    console.log("Please run 'myapp auth login' first");
    process.exit(1);
  }

  return fetch("https://api.example.com/data", {
    headers: { Authorization: `Bearer ${token}` },
  });
}
```

## Data Structures

```typescript
/** Response from device code initiation endpoint */
interface DeviceCodeResponse {
  deviceCode: string; // Secret - don't display
  userCode: string; // Display to user
  verificationUri: string; // URL for user to visit
  expiresIn: number; // Seconds until expiry
  interval: number; // Min seconds between polls
}

/** Response from polling endpoint */
interface PollResponse {
  status: "pending" | "authorized" | "expired" | "denied";
  sessionToken?: string; // Present when status is "authorized"
  error?: string; // Present when status is "denied"
}

/** Stored in OS keychain */
interface StoredSession {
  sessionToken: string;
  expiresAt: string; // ISO 8601 timestamp
}
```

## Error Handling

| Scenario                  | Handling                       |
| ------------------------- | ------------------------------ |
| Network error during poll | Retry with exponential backoff |
| Rate limited (429)        | Double poll interval           |
| Device code expired       | Prompt user to restart auth    |
| User denied               | Show error, exit gracefully    |
| Invalid/expired session   | Clear keychain, prompt re-auth |
| Corrupted keychain data   | Clear and prompt re-auth       |

## Security Considerations

1. **Never log or display the `deviceCode`** - only the `userCode` should be shown
2. **Use OS keychain** - avoid storing tokens in config files or environment variables
3. **Validate session expiry client-side** before making API calls
4. **Handle 401 responses** by clearing stored session and prompting re-auth
5. **Use HTTPS** for all API endpoints

## References

- [RFC 8628 - OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
- [GitHub CLI Auth Flow](https://cli.github.com/manual/gh_auth_login)
- [keytar - Native OS keychain access](https://www.npmjs.com/package/keytar)
