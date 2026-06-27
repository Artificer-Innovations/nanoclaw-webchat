/**
 * OIDC id_token signature verification (RS256 + JWKS).
 */
import crypto from 'crypto';

export interface JsonWebKey {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  x5c?: string[];
}

export interface IdTokenVerifyOptions {
  audience: string;
  issuer?: string;
  /** Seconds since epoch; defaults to now. */
  nowSeconds?: number;
  /** Leeway for exp/nbf checks in seconds. */
  clockSkewSeconds?: number;
}

function decodeJsonPart(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function jwkToPublicKey(jwk: JsonWebKey): crypto.KeyObject {
  if (jwk.kty === 'RSA' && jwk.n && jwk.e) {
    return crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
  }
  const cert = jwk.x5c?.[0];
  if (cert) {
    const pem = `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
    return crypto.createPublicKey(pem);
  }
  throw new Error('Unsupported JWK');
}

export function selectSigningKey(keys: JsonWebKey[], kid?: string): JsonWebKey {
  if (kid) {
    const match = keys.find((k) => k.kid === kid);
    if (match) return match;
  }
  const sigKey = keys.find((k) => k.use === 'sig' || k.use === undefined);
  if (sigKey) return sigKey;
  if (keys.length === 1) return keys[0]!;
  throw new Error('No matching JWK for id_token');
}

function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/$/, '');
}

function audienceMatches(aud: unknown, clientId: string): boolean {
  if (Array.isArray(aud)) return aud.some((entry) => String(entry) === clientId);
  return typeof aud === 'string' && aud === clientId;
}

/** Verify RS256 JWT signature and standard OIDC id_token claims. */
export function verifyRs256IdToken(
  jwt: string,
  keys: JsonWebKey[],
  options: IdTokenVerifyOptions,
): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');

  const header = decodeJsonPart(parts[0]!) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error(`Unsupported JWT alg: ${header.alg ?? 'unknown'}`);

  const payload = decodeJsonPart(parts[1]!) as Record<string, unknown>;
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2]!, 'base64url');

  const jwk = selectSigningKey(keys, header.kid);
  const publicKey = jwkToPublicKey(jwk);
  const valid = crypto.verify('RSA-SHA256', Buffer.from(signingInput), publicKey, signature);
  if (!valid) throw new Error('Invalid JWT signature');

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? 60;

  if (typeof payload.exp === 'number' && payload.exp + skew < now) {
    throw new Error('JWT expired');
  }
  if (typeof payload.nbf === 'number' && payload.nbf - skew > now) {
    throw new Error('JWT not yet valid');
  }
  if (!audienceMatches(payload.aud, options.audience)) {
    throw new Error('JWT audience mismatch');
  }
  if (options.issuer && typeof payload.iss === 'string') {
    if (normalizeIssuer(payload.iss) !== normalizeIssuer(options.issuer)) {
      throw new Error('JWT issuer mismatch');
    }
  }

  return payload;
}
