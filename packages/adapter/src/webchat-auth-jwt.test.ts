import crypto from 'crypto';
import { describe, expect, it } from 'vitest';

import {
  isJwksRetryableVerificationError,
  jwkToPublicKey,
  selectSigningKey,
  verifyIdToken,
  verifyRs256IdToken,
  type JsonWebKey,
} from './webchat-auth-jwt.js';

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signRs256Jwt(
  payload: Record<string, unknown>,
  privateKey: crypto.KeyObject,
  kid = 'test-key',
): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function rsaJwkFromPublicKey(publicKey: crypto.KeyObject, kid: string): JsonWebKey {
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  return { ...jwk, kid, use: 'sig', alg: 'RS256' };
}

function signEs256Jwt(
  payload: Record<string, unknown>,
  privateKey: crypto.KeyObject,
  kid = 'ec-key',
): string {
  const header = { alg: 'ES256', typ: 'JWT', kid };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function ecJwkFromPublicKey(publicKey: crypto.KeyObject, kid: string): JsonWebKey {
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  return { ...jwk, kid, use: 'sig', alg: 'ES256' };
}

describe('webchat-auth-jwt', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = rsaJwkFromPublicKey(publicKey, 'test-key');

  it('verifies a valid RS256 id_token', () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signRs256Jwt(
      {
        iss: 'https://issuer.example',
        aud: 'client-id',
        sub: 'user-1',
        exp: now + 3600,
      },
      privateKey,
    );

    const claims = verifyRs256IdToken(jwt, [jwk], {
      audience: 'client-id',
      issuer: 'https://issuer.example/',
      nowSeconds: now,
    });
    expect(claims.sub).toBe('user-1');
  });

  it('rejects tampered signatures', () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signRs256Jwt(
      { iss: 'https://issuer.example', aud: 'client-id', sub: 'user-1', exp: now + 3600 },
      privateKey,
    );
    const parts = jwt.split('.');
    const sigBytes = Buffer.from(parts[2]!, 'base64url');
    sigBytes[0]! ^= 0xff;
    const tampered = `${parts[0]}.${parts[1]}.${sigBytes.toString('base64url')}`;

    expect(() =>
      verifyRs256IdToken(tampered, [jwk], {
        audience: 'client-id',
        issuer: 'https://issuer.example',
        nowSeconds: now,
      }),
    ).toThrow(/Invalid JWT signature/);
  });

  it('rejects expired tokens', () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signRs256Jwt(
      { iss: 'https://issuer.example', aud: 'client-id', sub: 'user-1', exp: now - 10 },
      privateKey,
    );

    expect(() =>
      verifyRs256IdToken(jwt, [jwk], {
        audience: 'client-id',
        issuer: 'https://issuer.example',
        nowSeconds: now,
        clockSkewSeconds: 0,
      }),
    ).toThrow(/expired/);
  });

  it('rejects audience mismatch', () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signRs256Jwt(
      { iss: 'https://issuer.example', aud: 'other-client', sub: 'user-1', exp: now + 3600 },
      privateKey,
    );

    expect(() =>
      verifyRs256IdToken(jwt, [jwk], {
        audience: 'client-id',
        issuer: 'https://issuer.example',
        nowSeconds: now,
      }),
    ).toThrow(/audience/);
  });

  it('selects key by kid and imports JWK public key', () => {
    const selected = selectSigningKey([jwk], 'test-key');
    expect(selected.kid).toBe('test-key');
    expect(jwkToPublicKey(selected)).toBeDefined();
  });

  it('verifies a valid ES256 id_token', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const ecJwk = ecJwkFromPublicKey(publicKey, 'ec-key');
    const now = Math.floor(Date.now() / 1000);
    const jwt = signEs256Jwt(
      {
        iss: 'https://issuer.example',
        aud: 'client-id',
        sub: 'user-ec',
        exp: now + 3600,
      },
      privateKey,
    );

    const claims = verifyIdToken(jwt, [ecJwk], {
      audience: 'client-id',
      issuer: 'https://issuer.example',
      nowSeconds: now,
    });
    expect(claims.sub).toBe('user-ec');
  });

  it('rejects unsupported JWT algorithms', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
    const payload = base64UrlJson({
      iss: 'https://issuer.example',
      aud: 'client-id',
      sub: 'user-1',
      exp: now + 3600,
    });
    const jwt = `${header}.${payload}.signature`;

    expect(() =>
      verifyIdToken(jwt, [jwk], {
        audience: 'client-id',
        issuer: 'https://issuer.example',
        nowSeconds: now,
      }),
    ).toThrow(/Unsupported JWT alg/);
  });

  it('classifies JWKS-retryable verification errors', () => {
    expect(isJwksRetryableVerificationError(new Error('Invalid JWT signature'))).toBe(true);
    expect(isJwksRetryableVerificationError(new Error('No matching JWK for id_token'))).toBe(true);
    expect(isJwksRetryableVerificationError(new Error('JWT expired'))).toBe(false);
  });
});
