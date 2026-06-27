import crypto from 'crypto';
import { describe, expect, it } from 'vitest';

import {
  jwkToPublicKey,
  selectSigningKey,
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
    const tampered = `${jwt.slice(0, -1)}x`;

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
});
