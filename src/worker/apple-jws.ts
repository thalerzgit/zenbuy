/**
 * Verification for Apple's `JWSTransaction` payloads (StoreKit 2).
 *
 * A signed transaction is an ES256 JWS whose header carries the full signing
 * chain in `x5c`: leaf, Apple's intermediate, and Apple Root CA - G3. Trust
 * comes from checking every link of that chain and then pinning the root to
 * the copy embedded below, so a caller cannot swap in a chain of their own.
 *
 * Everything here is WebCrypto plus just enough DER walking to pull the four
 * fields a chain check needs out of a certificate.
 */

/** Apple Root CA - G3, DER, from https://www.apple.com/certificateauthority/ */
const APPLE_ROOT_CA_G3 =
  "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==";

const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const OID_ECDSA_SHA384 = "1.2.840.10045.4.3.3";
const OID_P256 = "1.2.840.10045.3.1.7";
const OID_P384 = "1.3.132.0.34";

/** Curve name paired with the byte width of one ECDSA signature half. */
const CURVES: Record<string, { name: string; half: number; hash: string }> = {
  [OID_P256]: { name: "P-256", half: 32, hash: "SHA-256" },
  [OID_P384]: { name: "P-384", half: 48, hash: "SHA-384" },
};

const SIG_HASHES: Record<string, string> = {
  [OID_ECDSA_SHA256]: "SHA-256",
  [OID_ECDSA_SHA384]: "SHA-384",
};

export class AppleJwsError extends Error {}

function fail(message: string): never {
  throw new AppleJwsError(message);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function base64UrlToString(value: string): string {
  return new TextDecoder().decode(base64ToBytes(value));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

interface DerNode {
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first content byte. */
  contentStart: number;
  /** Offset one past the last content byte. */
  end: number;
}

function readNode(buf: Uint8Array, offset: number): DerNode {
  if (offset + 2 > buf.length) fail("truncated DER");
  const tag = buf[offset];
  let cursor = offset + 1;
  let length = buf[cursor];
  cursor += 1;

  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) fail("unsupported DER length");
    length = 0;
    for (let i = 0; i < count; i += 1) {
      length = length * 256 + buf[cursor];
      cursor += 1;
    }
  }

  const end = cursor + length;
  if (end > buf.length) fail("DER length past end of buffer");
  return { tag, start: offset, contentStart: cursor, end };
}

/** Direct children of a constructed node, in order. */
function childNodes(buf: Uint8Array, node: DerNode): DerNode[] {
  const out: DerNode[] = [];
  let cursor = node.contentStart;
  while (cursor < node.end) {
    const child = readNode(buf, cursor);
    out.push(child);
    cursor = child.end;
  }
  return out;
}

function readOid(buf: Uint8Array, node: DerNode): string {
  if (node.tag !== 0x06) fail("expected OID");
  const bytes = buf.subarray(node.contentStart, node.end);
  if (!bytes.length) fail("empty OID");
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (let i = 1; i < bytes.length; i += 1) {
    value = value * 128 + (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

/** X.509 UTCTime / GeneralizedTime to epoch milliseconds. */
function readTime(buf: Uint8Array, node: DerNode): number {
  const raw = new TextDecoder().decode(buf.subarray(node.contentStart, node.end));
  const m =
    node.tag === 0x17
      ? raw.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/)
      : raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) fail("unsupported certificate time");
  // UTCTime's two-digit year: 50+ means 19xx per RFC 5280.
  const year = node.tag === 0x17 ? (Number(m[1]) >= 50 ? 1900 : 2000) + Number(m[1]) : Number(m[1]);
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

interface ParsedCertificate {
  der: Uint8Array;
  /** DER of tbsCertificate including its header — the bytes the issuer signed. */
  tbs: Uint8Array;
  signature: Uint8Array;
  signatureHash: string;
  spki: Uint8Array;
  curve: { name: string; half: number; hash: string };
  notBefore: number;
  notAfter: number;
}

function parseCertificate(der: Uint8Array): ParsedCertificate {
  const root = readNode(der, 0);
  if (root.tag !== 0x30) fail("certificate is not a SEQUENCE");
  const [tbsNode, sigAlgNode, sigNode] = childNodes(der, root);
  if (!tbsNode || !sigAlgNode || !sigNode) fail("malformed certificate");

  const sigAlgOid = readOid(der, childNodes(der, sigAlgNode)[0]);
  const signatureHash = SIG_HASHES[sigAlgOid];
  if (!signatureHash) fail(`unsupported certificate signature algorithm ${sigAlgOid}`);

  // BIT STRING content is prefixed with an unused-bits count.
  if (sigNode.tag !== 0x03) fail("expected signature BIT STRING");
  const signature = der.subarray(sigNode.contentStart + 1, sigNode.end);

  // TBSCertificate ::= SEQUENCE { [0] version, serialNumber, signature,
  //   issuer, validity, subject, subjectPublicKeyInfo, ... }
  const tbsChildren = childNodes(der, tbsNode);
  const offset = tbsChildren[0]?.tag === 0xa0 ? 1 : 0;
  const validityNode = tbsChildren[offset + 3];
  const spkiNode = tbsChildren[offset + 5];
  if (!validityNode || !spkiNode) fail("malformed tbsCertificate");

  const [notBeforeNode, notAfterNode] = childNodes(der, validityNode);
  const spkiAlg = childNodes(der, spkiNode)[0];
  const spkiAlgParts = childNodes(der, spkiAlg);
  const curveOid = spkiAlgParts[1] ? readOid(der, spkiAlgParts[1]) : "";
  const curve = CURVES[curveOid];
  if (!curve) fail(`unsupported certificate key curve ${curveOid || "(none)"}`);

  return {
    der,
    tbs: der.slice(tbsNode.start, tbsNode.end),
    signature,
    signatureHash,
    spki: der.slice(spkiNode.start, spkiNode.end),
    curve,
    notBefore: readTime(der, notBeforeNode),
    notAfter: readTime(der, notAfterNode),
  };
}

/** DER ECDSA-Sig-Value (SEQUENCE of two INTEGERs) to WebCrypto's raw r||s. */
function derSignatureToRaw(der: Uint8Array, half: number): Uint8Array {
  const seq = readNode(der, 0);
  if (seq.tag !== 0x30) fail("expected ECDSA signature SEQUENCE");
  const [rNode, sNode] = childNodes(der, seq);
  if (!rNode || !sNode) fail("malformed ECDSA signature");

  const out = new Uint8Array(half * 2);
  for (const [index, node] of [rNode, sNode].entries()) {
    let value = der.subarray(node.contentStart, node.end);
    // INTEGERs are signed, so a leading zero may pad a high bit; strip it.
    while (value.length > half && value[0] === 0) value = value.subarray(1);
    if (value.length > half) fail("ECDSA signature component too large");
    out.set(value, index * half + (half - value.length));
  }
  return out;
}

async function importPublicKey(cert: ParsedCertificate): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    // A fresh copy keeps WebCrypto off a possibly-shared ArrayBuffer view.
    cert.spki.slice().buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: cert.curve.name },
    false,
    ["verify"]
  );
}

/** Was `child` signed by `issuer`? */
async function verifyIssuedBy(
  child: ParsedCertificate,
  issuer: ParsedCertificate
): Promise<boolean> {
  const key = await importPublicKey(issuer);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: child.signatureHash },
    key,
    derSignatureToRaw(child.signature, issuer.curve.half).slice().buffer as ArrayBuffer,
    child.tbs.slice().buffer as ArrayBuffer
  );
}

export interface VerifyOptions {
  /** Epoch ms used for certificate validity windows. Defaults to now. */
  now?: number;
  /** Base64 DER of the trusted root. Tests pin their own; production pins Apple's. */
  rootCertificate?: string;
}

/**
 * Verify an Apple-signed JWS and return its decoded payload.
 *
 * Throws {@link AppleJwsError} on any failure — an unverifiable payload is
 * never returned in a degraded form, because the caller grants entitlements
 * on the strength of it.
 */
export async function verifyAppleJws<T>(token: string, options: VerifyOptions = {}): Promise<T> {
  const now = options.now ?? Date.now();
  const parts = token.split(".");
  if (parts.length !== 3) fail("malformed JWS");

  let header: { alg?: string; x5c?: string[] };
  try {
    header = JSON.parse(base64UrlToString(parts[0]));
  } catch {
    return fail("unreadable JWS header");
  }

  if (header.alg !== "ES256") fail(`unexpected JWS algorithm ${header.alg}`);
  const chain = header.x5c ?? [];
  if (chain.length < 2) fail("JWS is missing its certificate chain");

  const certs = chain.map((entry) => parseCertificate(base64ToBytes(entry)));

  const expectedRoot = base64ToBytes(options.rootCertificate ?? APPLE_ROOT_CA_G3);
  if (!bytesEqual(certs[certs.length - 1].der, expectedRoot)) {
    fail("certificate chain is not rooted in Apple Root CA - G3");
  }

  for (const cert of certs) {
    if (now < cert.notBefore || now > cert.notAfter) fail("certificate outside validity window");
  }

  // Walk down from the pinned root so trust is established before it is used.
  for (let i = certs.length - 1; i > 0; i -= 1) {
    if (!(await verifyIssuedBy(certs[i - 1], certs[i]))) fail("broken certificate chain");
  }

  const leaf = certs[0];
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signatureOk = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await importPublicKey(leaf),
    base64ToBytes(parts[2]).slice().buffer as ArrayBuffer,
    signed.buffer as ArrayBuffer
  );
  if (!signatureOk) fail("JWS signature does not verify");

  try {
    return JSON.parse(base64UrlToString(parts[1])) as T;
  } catch {
    return fail("unreadable JWS payload");
  }
}
