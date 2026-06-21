import { describe, expect, it } from 'vitest';
import {
  attachmentBasename,
  attachmentExtension,
  codeLanguageFromAttachment,
  isCodeFilename,
  isCodeMimeType,
} from './attachment-code';

describe('attachment-code', () => {
  it('detects code filenames and mime types', () => {
    expect(isCodeFilename('app.ts')).toBe(true);
    expect(isCodeFilename('Dockerfile')).toBe(true);
    expect(isCodeFilename('Makefile')).toBe(true);
    expect(isCodeFilename('build.mk')).toBe(true);
    expect(isCodeFilename('nginx.conf')).toBe(true);
    expect(isCodeFilename('Caddyfile')).toBe(true);
    expect(isCodeFilename('.env')).toBe(true);
    expect(isCodeFilename('notes.txt')).toBe(false);
    expect(isCodeMimeType('text/javascript')).toBe(true);
    expect(isCodeMimeType('text/x-matlab')).toBe(true);
    expect(isCodeMimeType('text/x-hcl')).toBe(true);
    expect(isCodeMimeType('text/plain')).toBe(false);
  });

  it('extracts attachment extensions and basenames', () => {
    expect(attachmentExtension('src/app.ts')).toBe('.ts');
    expect(attachmentExtension('.env')).toBe('.env');
    expect(attachmentExtension('README')).toBe('');
    expect(attachmentBasename('path/to/Dockerfile')).toBe('dockerfile');
    expect(attachmentBasename('etc/nginx.conf')).toBe('nginx.conf');
  });

  it('maps attachments to highlight.js languages', () => {
    expect(codeLanguageFromAttachment('app.js', 'text/javascript')).toBe('javascript');
    expect(codeLanguageFromAttachment('app.ts', 'text/typescript')).toBe('typescript');
    expect(codeLanguageFromAttachment('Main.java', 'text/x-java-source')).toBe('java');
    expect(codeLanguageFromAttachment('Program.cs', 'text/x-csharp')).toBe('csharp');
    expect(codeLanguageFromAttachment('script.lua', 'text/x-lua')).toBe('lua');
    expect(codeLanguageFromAttachment('analysis.R', 'text/x-r')).toBe('r');
    expect(codeLanguageFromAttachment('Dockerfile', 'text/x-dockerfile')).toBe('dockerfile');
    expect(codeLanguageFromAttachment('build.mk', 'application/octet-stream')).toBe('makefile');
    expect(codeLanguageFromAttachment('layout.pug', 'application/octet-stream')).toBe('pug');
    expect(codeLanguageFromAttachment('styles.styl', 'application/octet-stream')).toBe('stylus');
    expect(codeLanguageFromAttachment('page.jinja2', 'text/x-jinja2')).toBe('django');
    expect(codeLanguageFromAttachment('.env', 'text/plain')).toBe('ini');
    expect(codeLanguageFromAttachment('script.tcl', 'application/octet-stream')).toBe('tcl');
    expect(codeLanguageFromAttachment('config.libsonnet', 'application/json')).toBe('json');
    expect(codeLanguageFromAttachment('shader.wgsl', 'text/plain')).toBe('glsl');
    expect(codeLanguageFromAttachment('shader.hlsl', 'text/plain')).toBe('hlsl');
    expect(codeLanguageFromAttachment('App.vue', 'text/x-vue')).toBe('html');
    expect(codeLanguageFromAttachment('App.svelte', 'text/x-svelte')).toBe('html');
    expect(codeLanguageFromAttachment('main.tf', 'text/x-hcl')).toBe('hcl');
    expect(codeLanguageFromAttachment('README.rst', 'text/plain')).toBe('plaintext');
    expect(codeLanguageFromAttachment('deploy.ps1', 'text/x-powershell')).toBe('powershell');
    expect(codeLanguageFromAttachment('ViewController.m', 'text/x-objective-c')).toBe('objectivec');
    expect(codeLanguageFromAttachment('Main.hs', 'text/x-haskell')).toBe('haskell');
    expect(codeLanguageFromAttachment('server.ex', 'text/x-elixir')).toBe('elixir');
    expect(codeLanguageFromAttachment('core.clj', 'text/x-clojure')).toBe('clojure');
    expect(codeLanguageFromAttachment('main.dart', 'text/x-dart')).toBe('dart');
    expect(codeLanguageFromAttachment('Program.fs', 'text/x-fsharp')).toBe('fsharp');
    expect(codeLanguageFromAttachment('build.gradle', 'text/x-groovy')).toBe('groovy');
    expect(codeLanguageFromAttachment('model.jl', 'text/x-julia')).toBe('julia');
    expect(codeLanguageFromAttachment('types.hpp', 'application/octet-stream')).toBe('cpp');
    expect(codeLanguageFromAttachment('main.zig', 'text/x-zig')).toBe('cpp');
    expect(codeLanguageFromAttachment('schema.graphql', 'application/graphql')).toBe('graphql');
    expect(codeLanguageFromAttachment('analysis.m', 'text/x-matlab')).toBe('matlab');
    expect(codeLanguageFromAttachment('nginx.conf', 'application/octet-stream')).toBe('nginx');
    expect(codeLanguageFromAttachment('Caddyfile', 'application/octet-stream')).toBe('nginx');
    expect(codeLanguageFromAttachment('unknown.xyz', 'application/octet-stream')).toBeNull();
  });
});
