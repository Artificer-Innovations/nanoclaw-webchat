/**
 * Bridges adapter MCP OAuth backend to @modelcontextprotocol/sdk OAuthServerProvider.
 *
 * PKCE: the MCP SDK calls `challengeForAuthorizationCode` and verifies S256 against the
 * token-request `code_verifier` *before* invoking `exchangeAuthorizationCode`. We still
 * forward the verifier and redirect_uri so the backend can re-validate as defence-in-depth.
 */
import type { Response } from 'express';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

export interface WebchatMcpOAuthBackendLike {
  clientsStore: {
    getClient(clientId: string): Promise<McpOAuthClientLike | undefined>;
    registerClient?(
      client: Omit<McpOAuthClientLike, 'client_id'> & { client_id?: string },
    ): Promise<McpOAuthClientLike>;
  };
  buildAuthorizeReturnUrl(req: { url?: string | null }): string;
  authorize(
    req: { headers: { cookie?: string | string[] | undefined } },
    client: McpOAuthClientLike,
    params: {
      state?: string;
      scopes: string[];
      codeChallenge: string;
      redirectUri: string;
      resource?: string;
    },
  ): { type: 'redirect'; location: string };
  challengeForAuthorizationCode(client: McpOAuthClientLike, authorizationCode: string): Promise<string>;
  exchangeAuthorizationCode(
    client: McpOAuthClientLike,
    authorizationCode: string,
    resource?: string,
    options?: { codeVerifier?: string; redirectUri?: string },
  ): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
  }>;
  verifyAccessToken(token: string): Promise<{
    userId: string;
    displayName: string;
    clientId: string;
    scopes: string[];
    resource?: string;
  } | null> | {
    userId: string;
    displayName: string;
    clientId: string;
    scopes: string[];
    resource?: string;
  } | null;
}

export interface McpOAuthClientLike {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
}

export function wrapWebchatMcpOAuthBackend(backend: WebchatMcpOAuthBackendLike): OAuthServerProvider {
  const clientsStore = {
    getClient: (clientId: string) => backend.clientsStore.getClient(clientId),
    registerClient: backend.clientsStore.registerClient
      ? (client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>) =>
          backend.clientsStore.registerClient!(client)
      : undefined,
  };

  return {
    clientsStore,

    async authorize(client, params, res: Response) {
      const req = res.req;
      const result = backend.authorize(req, client as McpOAuthClientLike, {
        state: params.state,
        scopes: params.scopes ?? [],
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        resource: params.resource?.href,
      });
      res.redirect(302, result.location);
    },

    challengeForAuthorizationCode(client, authorizationCode) {
      return backend.challengeForAuthorizationCode(client as McpOAuthClientLike, authorizationCode);
    },

    async exchangeAuthorizationCode(client, authorizationCode, codeVerifier, redirectUri, resource) {
      return backend.exchangeAuthorizationCode(
        client as McpOAuthClientLike,
        authorizationCode,
        resource?.href,
        {
          codeVerifier,
          redirectUri,
        },
      );
    },

    async exchangeRefreshToken() {
      // Refresh not implemented yet; access tokens use a longer TTL (see MCP_ACCESS_TOKEN_TTL_SECONDS).
      throw new Error('refresh_token grant not supported');
    },

    async verifyAccessToken(token) {
      const user = await backend.verifyAccessToken(token);
      if (!user) throw new Error('Invalid or expired token');
      return {
        token,
        clientId: user.clientId,
        scopes: user.scopes,
        resource: user.resource ? new URL(user.resource) : undefined,
        extra: {
          userId: user.userId,
          displayName: user.displayName,
        },
      };
    },
  };
}
