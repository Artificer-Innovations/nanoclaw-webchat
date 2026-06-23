export function withShellNodeMajor(major: number, run: () => void): void {
  const version = `v${major}.0.0`;
  const descriptor = Object.getOwnPropertyDescriptor(process, 'version');
  Object.defineProperty(process, 'version', { configurable: true, value: version });
  try {
    run();
  } finally {
    if (descriptor) {
      Object.defineProperty(process, 'version', descriptor);
    }
  }
}
