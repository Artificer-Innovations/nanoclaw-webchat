/**
 * Fixture stub — real NanoClaw host module. Overridden by vi.mock in
 * webchat-boot.test.ts; present so dynamic imports resolve in the fixture tree.
 */
export function registerDeliveryAction(
  _action: string,
  _handler: (...args: unknown[]) => Promise<void>,
  _spec?: unknown,
): void {}

export function reenterGuardedDeliveryAction(_action: string): (ctx: unknown) => Promise<void> {
  return async () => undefined;
}
