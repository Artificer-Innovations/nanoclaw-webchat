import type { Response } from 'express';
import { describe, it, expect, vi } from 'vitest';

import { wrapWebchatMcpOAuthBackend, type WebchatMcpOAuthBackendLike } from './oauth-bridge.js';

function mockBackend(overrides: Partial<WebchatMcpOAuthBackendLike> = {}): WebchatMcpOAuthBackendLike {
  return {
    clientsStore: {
      getClient: vi.fn(),
      registerClient: vi.fn(),
    },
    buildAuthorizeReturnUrl: () => 'http://127.0.0.1:3200/authorize?client_id=test',
    authorize: vi.fn(() => ({ type: 'redirect' as const, location: 'http://127.0.0.1/cb?code=abc' })),
    challengeForAuthorizationCode: vi.fn(async () => 'challenge'),
    exchangeAuthorizationCode: vi.fn(async () => ({
      access_token: 'token-1',
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'mcp:tools',
    })),
    verifyAccessToken: vi.fn(() => ({
      userId: 'web:basic:alice',
      displayName: 'Alice',
      clientId: 'client-1',
      scopes: ['mcp:tools'],
      resource: 'http://127.0.0.1:3200/mcp',
    })),
    ...overrides,
  };
}

describe('wrapWebchatMcpOAuthBackend', () => {
  it('wraps authorize and token exchange', async () => {
    const backend = mockBackend();
    const provider = wrapWebchatMcpOAuthBackend(backend);
    const redirect = vi.fn();
    const res = { redirect, req: { headers: {} } } as unknown as Response;

    await provider.authorize(
      { client_id: 'client-1', redirect_uris: ['http://127.0.0.1/cb'] },
      {
        state: 's',
        scopes: ['mcp:tools'],
        codeChallenge: 'abc',
        redirectUri: 'http://127.0.0.1/cb',
        resource: new URL('http://127.0.0.1:3200/mcp'),
      },
      res,
    );

    expect(redirect).toHaveBeenCalledWith(302, 'http://127.0.0.1/cb?code=abc');
    await expect(
      provider.challengeForAuthorizationCode({ client_id: 'client-1', redirect_uris: [] }, 'code'),
    ).resolves.toBe('challenge');
    await expect(
      provider.exchangeAuthorizationCode(
        { client_id: 'client-1', redirect_uris: [] },
        'code',
        undefined,
        undefined,
        new URL('http://127.0.0.1:3200/mcp'),
      ),
    ).resolves.toMatchObject({ access_token: 'token-1' });
  });

  it('verifyAccessToken maps user extra fields', async () => {
    const provider = wrapWebchatMcpOAuthBackend(mockBackend());
    const info = await provider.verifyAccessToken('token-1');
    expect(info.extra).toEqual({ userId: 'web:basic:alice', displayName: 'Alice' });
    expect(info.clientId).toBe('client-1');
  });

  it('verifyAccessToken throws for invalid token', async () => {
    const provider = wrapWebchatMcpOAuthBackend(
      mockBackend({ verifyAccessToken: () => null }),
    );
    await expect(provider.verifyAccessToken('bad')).rejects.toThrow(/Invalid or expired token/);
  });

  it('verifyAccessToken omits resource when absent', async () => {
    const provider = wrapWebchatMcpOAuthBackend(
      mockBackend({
        verifyAccessToken: () => ({
          userId: 'web:basic:alice',
          displayName: 'Alice',
          clientId: 'client-1',
          scopes: ['mcp:tools'],
        }),
      }),
    );
    const info = await provider.verifyAccessToken('token-1');
    expect(info.resource).toBeUndefined();
  });

  it('exchangeRefreshToken is unsupported', async () => {
    const provider = wrapWebchatMcpOAuthBackend(mockBackend());
    await expect(
      provider.exchangeRefreshToken({ client_id: 'c', redirect_uris: [] }, 'rt'),
    ).rejects.toThrow(/not supported/);
  });

  it('omits registerClient when store lacks it', () => {
    const provider = wrapWebchatMcpOAuthBackend(
      mockBackend({ clientsStore: { getClient: vi.fn() } }),
    );
    expect(provider.clientsStore.registerClient).toBeUndefined();
  });

  it('authorize forwards requests without optional scopes', async () => {
    const backend = mockBackend();
    const provider = wrapWebchatMcpOAuthBackend(backend);
    const redirect = vi.fn();
    const res = { redirect, req: { headers: {} } } as unknown as Response;

    await provider.authorize(
      { client_id: 'client-1', redirect_uris: ['http://127.0.0.1/cb'] },
      {
        codeChallenge: 'abc',
        redirectUri: 'http://127.0.0.1/cb',
        resource: new URL('http://127.0.0.1:3200/mcp'),
      },
      res,
    );

    expect(backend.authorize).toHaveBeenCalledWith(
      res.req,
      expect.anything(),
      expect.objectContaining({ scopes: [] }),
    );
  });

  it('forwards getClient through clientsStore', async () => {
    const getClient = vi.fn();
    const provider = wrapWebchatMcpOAuthBackend(
      mockBackend({ clientsStore: { getClient } }),
    );
    await provider.clientsStore.getClient('client-id');
    expect(getClient).toHaveBeenCalledWith('client-id');
  });

  it('forwards registerClient through clientsStore', async () => {
    const registerClient = vi.fn(async (client) => ({
      ...client,
      client_id: 'new-id',
    }));
    const provider = wrapWebchatMcpOAuthBackend(
      mockBackend({
        clientsStore: { getClient: vi.fn(), registerClient },
      }),
    );
    await provider.clientsStore.registerClient!({
      redirect_uris: ['http://127.0.0.1/cb'],
    });
    expect(registerClient).toHaveBeenCalled();
  });
});
