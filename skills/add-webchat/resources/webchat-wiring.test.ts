/**
 * Wiring test for the add-webchat skill's code-edit integration point.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const indexPath = path.resolve(process.cwd(), 'src/index.ts');
const source = fs.readFileSync(indexPath, 'utf8');
const sf = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);

function mainBody(): ts.NodeArray<ts.Statement> {
  let body: ts.NodeArray<ts.Statement> | undefined;
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'main' && n.body) {
      body = n.body.statements;
    }
  });
  if (!body) throw new Error('main() not found in src/index.ts');
  return body;
}

function isAwaitedStartWebChat(s: ts.Statement): boolean {
  return (
    ts.isExpressionStatement(s) &&
    ts.isAwaitExpression(s.expression) &&
    ts.isCallExpression(s.expression.expression) &&
    ts.isIdentifier(s.expression.expression.expression) &&
    s.expression.expression.expression.text === 'startWebChat'
  );
}

function isDynamicImportOfWebchatBoot(s: ts.Statement): boolean {
  if (!ts.isVariableStatement(s)) return false;
  const init = s.declarationList.declarations[0]?.initializer;
  if (!init || !ts.isAwaitExpression(init) || !ts.isCallExpression(init.expression)) return false;
  const call = init.expression;
  if (call.expression.kind !== ts.SyntaxKind.ImportKeyword) return false;
  const arg = call.arguments[0];
  return !!arg && ts.isStringLiteral(arg) && arg.text === './webchat-boot.js';
}

describe('add-webchat wiring in src/index.ts', () => {
  it('dynamically imports webchat-boot and awaits startWebChat() before channel init', () => {
    const stmts = mainBody();
    const importIdx = stmts.findIndex(isDynamicImportOfWebchatBoot);
    const callIdx = stmts.findIndex(isAwaitedStartWebChat);
    const migrateIdx = stmts.findIndex((s) => s.getText(sf).includes('runMigrations('));
    const channelIdx = stmts.findIndex((s) => s.getText(sf).includes('initChannelAdapters('));

    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThanOrEqual(0);
    expect(migrateIdx).toBeGreaterThanOrEqual(0);
    expect(channelIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeGreaterThan(migrateIdx);
    expect(callIdx).toBeGreaterThan(importIdx);
    expect(callIdx).toBeLessThan(channelIdx);
  });
});
