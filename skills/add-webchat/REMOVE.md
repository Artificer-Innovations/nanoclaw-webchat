# Remove /add-webchat

Idempotent uninstall. Safe to re-run.

Or run:

```bash
pnpm exec nanoclaw-webchat uninstall
```

## 1. Remove copied files

```bash
rm -f src/channels/web.ts src/channels/web.test.ts src/channels/web-registration.test.ts
rm -f src/webchat-sync.ts src/webchat-sync.test.ts src/webchat-boot.ts src/webchat-boot.test.ts src/webchat-wiring.test.ts
rm -f src/webchat-live.ts src/webchat-live.test.ts
rm -f src/webchat-store.ts src/webchat-store.test.ts src/webchat-thread-cleanup.ts
rm -f src/webchat-routing.ts src/webchat-routing.test.ts
rm -f src/webchat-mentions.ts src/webchat-mentions.test.ts
```

Optional: remove persisted web chat data (threads, messages, attachment files):

```bash
rm -f data/webchat.db
rm -rf data/webchat/files
```

## 2. Remove barrel import

Delete this line from `src/channels/index.ts` if present:

```typescript
import './web.js';
```

## 3. Remove index.ts integration block

Delete the colocated block from `main()` in `src/index.ts`:

```typescript
  const { startWebChat } = await import('./webchat-boot.js');
  await startWebChat();
```

## 3b. Revert host patches (CLI does this)

`nanoclaw-webchat uninstall` removes only the managed patches it installed:

- `src/router.ts` lobby-routing (`nanoclaw-webchat:lobby-routing` markers)
- `src/delivery.ts` sender-attribution (`nanoclaw-webchat:sender-attribution` markers)

If the host already had an equivalent MyNanoClaw/Quad integration without those markers, uninstall leaves it alone.

## 4. Uninstall packages

```bash
pnpm remove nanoclaw-webchat ws
pnpm remove -D @types/ws
```

## 5. Remove .env lines

Delete `WEBCHAT_*` variables from `.env`.

## 6. Build and restart

```bash
pnpm run build
# restart your NanoClaw host service
```

Web messaging groups and wirings remain in the DB but are inert without the adapter. Remove manually with `ncl` if desired.
