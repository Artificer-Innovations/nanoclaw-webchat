import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  fetchAuthConfig,
  loginBasic,
  startOidcLogin,
  type AuthConfigResponse,
} from './api';

export interface LoginProps {
  onSuccess: () => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [config, setConfig] = useState<AuthConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void fetchAuthConfig()
      .then(setConfig)
      .catch(() => setError('Unable to load login options'))
      .finally(() => setLoading(false));
  }, []);

  const handleBasicSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        await loginBasic(username, password);
        onSuccess();
      } catch {
        setError('Invalid username or password');
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, onSuccess],
  );

  if (loading) {
    return (
      <div className="auth-screen">
        <p className="hint">Loading…</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="auth-screen">
        <h1>NanoClaw Web Chat</h1>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const showBasic = config.basic.enabled;
  const showProviders = config.providers.length > 0;
  const showDivider = showBasic && showProviders;

  return (
    <div className="auth-screen">
      <h1>NanoClaw Web Chat</h1>

      {showBasic && (
        <form className="login-form" onSubmit={handleBasicSubmit}>
          <label className="login-field">
            <span>Username</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
            />
          </label>
          <label className="login-field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </label>
          <button type="submit" className="login-submit" disabled={submitting}>
            Sign in
          </button>
        </form>
      )}

      {showDivider && <p className="login-divider">or</p>}

      {showProviders && (
        <div className="login-providers">
          {config.providers.map((provider: AuthConfigResponse['providers'][number]) => (
            <button
              key={provider.id}
              type="button"
              className="login-provider-btn"
              disabled={submitting}
              onClick={() => startOidcLogin(provider.id)}
            >
              {provider.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
