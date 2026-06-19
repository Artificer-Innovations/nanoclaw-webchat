import { beforeEach, describe, expect, it, vi } from 'vitest';

const render = vi.fn();
const createRoot = vi.fn(() => ({ render }));

vi.mock('react-dom/client', () => ({
  createRoot,
}));

vi.mock('./styles.css', () => ({}));

describe('main', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
    render.mockClear();
    createRoot.mockClear();
  });

  it('mounts the App inside StrictMode', async () => {
    await import('./main');

    expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'));
    expect(render).toHaveBeenCalledTimes(1);
    const renderedTree = render.mock.calls[0]?.[0];
    expect(renderedTree.type).toBe(Symbol.for('react.strict_mode'));
  });
});
