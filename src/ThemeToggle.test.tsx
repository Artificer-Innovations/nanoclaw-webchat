import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('ThemeToggle', () => {
  it('selects themes with click and arrow keys', async () => {
    localStorage.setItem('webchat_theme', 'light');
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const light = screen.getByRole('radio', { name: 'Light' });
    const system = screen.getByRole('radio', { name: 'System' });
    const dark = screen.getByRole('radio', { name: 'Dark' });

    expect(light).toHaveAttribute('aria-checked', 'true');
    expect(light).toHaveAttribute('tabindex', '0');
    expect(system).toHaveAttribute('tabindex', '-1');

    light.focus();
    await user.keyboard('{ArrowRight}');
    expect(system).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('webchat_theme')).toBe('system');

    await user.keyboard('{ArrowRight}');
    expect(dark).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(system).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowUp}');
    expect(light).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowDown}');
    expect(system).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{Home}');
    expect(light).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{End}');
    expect(dark).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ignores unrelated keys', async () => {
    localStorage.setItem('webchat_theme', 'light');
    const user = userEvent.setup();
    render(<ThemeToggle />);

    screen.getByRole('radio', { name: 'Light' }).focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('webchat_theme')).toBe('light');
  });
});
