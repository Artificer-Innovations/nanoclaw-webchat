/** Fixture stub — overridden by vi.mock in webchat-boot.test.ts. */
export function registerApprovalHandler(
  _kind: string,
  _handler: (ctx: unknown) => Promise<void>,
): void {}

export function getApprovalHandler(
  _kind: string,
): ((ctx: unknown) => Promise<void>) | undefined {
  return undefined;
}
