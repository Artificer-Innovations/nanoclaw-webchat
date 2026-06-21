import type { LanguageFn } from 'highlight.js';
import hljs from 'highlight.js/lib/core';
import actionscript from 'highlight.js/lib/languages/actionscript';
import ada from 'highlight.js/lib/languages/ada';
import applescript from 'highlight.js/lib/languages/applescript';
import asciidoc from 'highlight.js/lib/languages/asciidoc';
import autohotkey from 'highlight.js/lib/languages/autohotkey';
import autoit from 'highlight.js/lib/languages/autoit';
import awk from 'highlight.js/lib/languages/awk';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import clojure from 'highlight.js/lib/languages/clojure';
import cmake from 'highlight.js/lib/languages/cmake';
import coffeescript from 'highlight.js/lib/languages/coffeescript';
import coq from 'highlight.js/lib/languages/coq';
import cpp from 'highlight.js/lib/languages/cpp';
import crystal from 'highlight.js/lib/languages/crystal';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import d from 'highlight.js/lib/languages/d';
import dart from 'highlight.js/lib/languages/dart';
import delphi from 'highlight.js/lib/languages/delphi';
import diff from 'highlight.js/lib/languages/diff';
import django from 'highlight.js/lib/languages/django';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import elixir from 'highlight.js/lib/languages/elixir';
import elm from 'highlight.js/lib/languages/elm';
import erb from 'highlight.js/lib/languages/erb';
import erlang from 'highlight.js/lib/languages/erlang';
import fortran from 'highlight.js/lib/languages/fortran';
import fsharp from 'highlight.js/lib/languages/fsharp';
import glsl from 'highlight.js/lib/languages/glsl';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import groovy from 'highlight.js/lib/languages/groovy';
import handlebars from 'highlight.js/lib/languages/handlebars';
import haskell from 'highlight.js/lib/languages/haskell';
import haxe from 'highlight.js/lib/languages/haxe';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import julia from 'highlight.js/lib/languages/julia';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import less from 'highlight.js/lib/languages/less';
import lisp from 'highlight.js/lib/languages/lisp';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import matlab from 'highlight.js/lib/languages/matlab';
import nginx from 'highlight.js/lib/languages/nginx';
import nim from 'highlight.js/lib/languages/nim';
import nix from 'highlight.js/lib/languages/nix';
import objectivec from 'highlight.js/lib/languages/objectivec';
import ocaml from 'highlight.js/lib/languages/ocaml';
import perl from 'highlight.js/lib/languages/perl';
import pgsql from 'highlight.js/lib/languages/pgsql';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import prolog from 'highlight.js/lib/languages/prolog';
import protobuf from 'highlight.js/lib/languages/protobuf';
import puppet from 'highlight.js/lib/languages/puppet';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import reasonml from 'highlight.js/lib/languages/reasonml';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scheme from 'highlight.js/lib/languages/scheme';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import stylus from 'highlight.js/lib/languages/stylus';
import swift from 'highlight.js/lib/languages/swift';
import tcl from 'highlight.js/lib/languages/tcl';
import twig from 'highlight.js/lib/languages/twig';
import typescript from 'highlight.js/lib/languages/typescript';
import vbnet from 'highlight.js/lib/languages/vbnet';
import verilog from 'highlight.js/lib/languages/verilog';
import vhdl from 'highlight.js/lib/languages/vhdl';
import wasm from 'highlight.js/lib/languages/wasm';
import x86asm from 'highlight.js/lib/languages/x86asm';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGE_MODULES: Record<string, LanguageFn> = {
  actionscript,
  ada,
  applescript,
  asciidoc,
  autohotkey,
  autoit,
  awk,
  bash,
  c,
  clojure,
  cmake,
  coffeescript,
  coq,
  cpp,
  crystal,
  csharp,
  css,
  d,
  dart,
  delphi,
  diff,
  django,
  dockerfile,
  dos,
  elixir,
  elm,
  erb,
  erlang,
  fortran,
  fsharp,
  glsl,
  go,
  graphql,
  groovy,
  handlebars,
  haskell,
  haxe,
  hcl: ini,
  hlsl: glsl,
  html: xml,
  ini,
  java,
  javascript,
  json,
  julia,
  kotlin,
  latex,
  less,
  lisp,
  lua,
  makefile,
  markdown,
  matlab,
  nginx,
  nim,
  nix,
  objectivec,
  ocaml,
  perl,
  pgsql,
  php,
  plaintext,
  powershell,
  prolog,
  protobuf,
  pug: plaintext,
  puppet,
  python,
  r,
  reasonml,
  ruby,
  rust,
  scala,
  scheme,
  scss,
  sql,
  stylus,
  swift,
  tcl,
  twig,
  typescript,
  vbnet,
  verilog,
  vhdl,
  wasm,
  x86asm,
  xml,
  yaml,
};

const registered = new Set<string>();

export function registerHighlightLanguage(language: string): void {
  if (registered.has(language)) return;
  const definition = LANGUAGE_MODULES[language];
  if (!definition) return;
  hljs.registerLanguage(language, definition);
  registered.add(language);
}

export function registerAllHighlightLanguages(): void {
  for (const language of Object.keys(LANGUAGE_MODULES)) {
    registerHighlightLanguage(language);
  }
}

export function highlightCodeHtml(text: string, language: string | null): string {
  if (language) {
    registerHighlightLanguage(language);
    if (hljs.getLanguage(language)) {
      return hljs.highlight(text, { language, ignoreIllegals: true }).value;
    }
  }
  registerAllHighlightLanguages();
  return hljs.highlightAuto(text, Object.keys(LANGUAGE_MODULES)).value;
}

export const SUPPORTED_HIGHLIGHT_LANGUAGES = Object.keys(LANGUAGE_MODULES).sort();
