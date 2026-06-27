import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from './api';
import { Login } from './Login';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    fetchAuthConfig: vi.fn(actual.fetchAuthConfig),
    loginBasic: vi.fn(actual.loginBasic),
    startOidcLogin: vi.fn(actual.startOidcLogin),
  };
});

describe('Login', () => {
  beforeEach(() => {
    vi.mocked(api.fetchAuthConfig).mockResolvedValue({
      basic: { enabled: true },
      providers: [{ id: 'google', label: 'Login with Google' }],
    });
    vi.mocked(api.loginBasic).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows loading then the login form', async () => {
    render(<Login onSuccess={vi.fn()} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login with Google' })).toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
  });

  it('shows error when config fails to load', async () => {
    vi.mocked(api.fetchAuthConfig).mockRejectedValue(new Error('network'));
    render(<Login onSuccess={vi.fn()} />);
    expect(await screen.findByText('Unable to load login options')).toBeInTheDocument();
  });

  it('submits basic credentials and calls onSuccess', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(<Login onSuccess={onSuccess} />);
    await screen.findByLabelText(/username/i);
    await user.type(screen.getByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password/i), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.loginBasic).toHaveBeenCalledWith('alice', 'secret'));
    expect(onSuccess).toHaveBeenCalled();
  });

  it('shows error on failed basic login', async () => {
    vi.mocked(api.loginBasic).mockRejectedValue(new Error('bad'));
    const user = userEvent.setup();
    render(<Login onSuccess={vi.fn()} />);
    await screen.findByLabelText(/username/i);
    await user.type(screen.getByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
  });

  it('starts OIDC login for provider buttons', async () => {
    const user = userEvent.setup();
    render(<Login onSuccess={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Login with Google' }));
    expect(api.startOidcLogin).toHaveBeenCalledWith('google');
  });

  it('hides basic form when basic auth is disabled', async () => {
    vi.mocked(api.fetchAuthConfig).mockResolvedValue({
      basic: { enabled: false },
      providers: [{ id: 'github', label: 'Login with GitHub' }],
    });
    render(<Login onSuccess={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Login with GitHub' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });

  it('shows form only when OIDC is disabled', async () => {
    vi.mocked(api.fetchAuthConfig).mockResolvedValue({
      basic: { enabled: true },
      providers: [],
    });
    render(<Login onSuccess={vi.fn()} />);
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });
});
