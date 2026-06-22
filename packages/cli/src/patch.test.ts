import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncSkillToFork } from './patch.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('syncSkillToFork', () => {
  it('copies nested skill directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-host-'));
    tempDirs.push(root);
    const skillSource = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-src-'));
    tempDirs.push(skillSource);
    fs.writeFileSync(path.join(skillSource, 'SKILL.md'), '# skill\n');
    fs.mkdirSync(path.join(skillSource, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(skillSource, 'resources', 'web.ts'), 'export {};\n');

    const dest = syncSkillToFork(root, skillSource);

    expect(dest).toBe(path.join(root, '.claude/skills/add-webchat'));
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toBe('# skill\n');
    expect(fs.readFileSync(path.join(dest, 'resources', 'web.ts'), 'utf8')).toBe('export {};\n');
  });
});
