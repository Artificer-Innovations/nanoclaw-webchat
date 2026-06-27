import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, vi } from 'vitest';
import { installMemoryStorage } from './storage';

installMemoryStorage();

function mockBrowserMediaCapabilities() {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type: string) => {
    if (type.startsWith('video/') || type.startsWith('audio/')) return 'maybe';
    return '';
  });
}

beforeAll(() => {
  mockBrowserMediaCapabilities();
});

afterEach(() => {
  mockBrowserMediaCapabilities();
});
