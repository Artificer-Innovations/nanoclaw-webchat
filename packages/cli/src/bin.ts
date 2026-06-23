#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNanoclawRoot } from './paths.js';
import {
  printInstallNextSteps,
  runInstall,
  runUninstall,
  runUpgrade,
  runVerify,
} from './install.js';
import { syncSkillToFork } from './patch.js';

function parseArgs(argv: string[]): { command: string; path?: string } {
  const args = argv.slice(2);
  const command = args[0] ?? 'help';
  let pathArg: string | undefined;
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === '--path' && args[i + 1]) {
      pathArg = args[i + 1];
      i += 1;
    }
  }
  return { command, path: pathArg };
}

export function runCommand(argv: string[]): number {
  const { command, path } = parseArgs(argv);

  try {
    switch (command) {
      case 'install': {
        const result = runInstall(path);
        printInstallNextSteps(result);
        return 0;
      }
      case 'upgrade': {
        const result = runUpgrade(path);
        console.log(`Synced skill → ${result.skillPath}`);
        printInstallNextSteps(result);
        return 0;
      }
      case 'sync-skill': {
        const root = path ?? findNanoclawRoot();
        const dest = syncSkillToFork(root);
        console.log(`Synced skill → ${dest}`);
        return 0;
      }
      case 'verify': {
        const result = runVerify(path);
        if (result.output.trim()) process.stdout.write(`${result.output}\n`);
        if (!result.ok) return 1;
        if (result.notice) console.log(result.notice);
        console.log('Verification passed.');
        if (result.hostReminder) console.log(result.hostReminder);
        return 0;
      }
      case 'uninstall': {
        const result = runUninstall(path);
        console.log(`Removed adapter from ${result.root}`);
        console.log(`Deleted ${result.removedFiles.length} files.`);
        console.log('\nOptional: pnpm remove nanoclaw-webchat ws');
        console.log('Optional: pnpm remove -D @types/ws');
        console.log('Then: pnpm run build && restart host');
        return 0;
      }
      default:
        console.log(`Usage: nanoclaw-webchat <command> [--path <nanoclaw-root>]

Commands:
  install      Copy adapter, patch host, scaffold .env
  upgrade      sync-skill + install
  sync-skill   Copy bundled skill to .claude/skills/add-webchat/
  verify       Run adapter verification tests in NanoClaw fork
  uninstall    Remove adapter files and host patches
`);
        return command === 'help' ? 0 : 1;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
}

export { parseArgs };

export function isCliEntry(entryPath: string, argv: string[]): boolean {
  if (!argv[1]) return false;
  try {
    return realpathSync(entryPath) === realpathSync(path.resolve(argv[1]));
  } catch {
    return entryPath === argv[1];
  }
}

function main(): void {
  process.exit(runCommand(process.argv));
}

export { main };

/* v8 ignore start -- CLI entry when executed directly */
if (isCliEntry(fileURLToPath(import.meta.url), process.argv)) {
  main();
}
/* v8 ignore stop */
