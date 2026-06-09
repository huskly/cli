/**
 * Extract the Diffie-Hellman prime (hex) from a dhparam.pem.
 *
 * IBKR's OAuth 1.0a live-session-token exchange (via `ibkr-client`) needs the DH
 * prime as a continuous hex string — it does `BigInt('0x' + dhPrime)`. We parse
 * the PEM's ASN.1 DER directly instead of shelling out to `openssl`.
 *
 * A DH parameters structure is: SEQUENCE { INTEGER prime, INTEGER generator }.
 * We read the first INTEGER and return it as lowercase hex.
 */

/** Read an ASN.1 DER length field at `offset`. Returns the value length and header size. */
function readLength(der: Buffer, offset: number): { length: number; headerLen: number } {
  const first = der[offset] ?? 0;
  if (first < 0x80) return { length: first, headerLen: 1 };
  const numBytes = first & 0x7f;
  let length = 0;
  for (let i = 1; i <= numBytes; i++) {
    length = (length << 8) | (der[offset + i] ?? 0);
  }
  return { length, headerLen: 1 + numBytes };
}

export function extractDhPrime(pem: string): string {
  const base64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Buffer.from(base64, "base64");

  let offset = 0;
  if (der[offset] !== 0x30) {
    throw new Error("Invalid dhparam.pem: expected an ASN.1 SEQUENCE");
  }
  offset += 1 + readLength(der, offset + 1).headerLen; // skip SEQUENCE tag + length

  if (der[offset] !== 0x02) {
    throw new Error("Invalid dhparam.pem: expected an INTEGER (the prime)");
  }
  offset += 1;
  const { length, headerLen } = readLength(der, offset);
  offset += headerLen;

  let prime = der.subarray(offset, offset + length);
  // Strip the leading sign byte DER adds to keep the integer positive.
  if (prime[0] === 0x00) prime = prime.subarray(1);

  return prime.toString("hex");
}
