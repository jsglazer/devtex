/**
 * Reviewer criterion: the companion plugin only registers `tex` and never
 * unregisters `md` (and never touches the link resolver).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import DevTexPlugin, { TEX_EXTENSIONS } from '../src/main.js';
import { fileKnowledge, VIEW_TYPE_TEX } from '../src/tex-view.js';
import { calls } from './obsidian-stub.js';

const SRC = join(import.meta.dirname, '..', 'src');

describe('DevTex Obsidian plugin', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('registers exactly the tex extension with the DevTex view', () => {
    new DevTexPlugin().onload();
    const reg = calls.filter((c) => c.method === 'registerExtensions');
    expect(reg).toEqual([{ method: 'registerExtensions', args: [['tex'], VIEW_TYPE_TEX] }]);
    expect(calls.find((c) => c.method === 'registerView')?.args[0]).toBe(VIEW_TYPE_TEX);
    expect(TEX_EXTENSIONS).toEqual(['tex']);
  });

  it('source never registers/unregisters md or overrides link resolution', () => {
    for (const f of readdirSync(SRC)) {
      const code = readFileSync(join(SRC, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(
        /unregisterExtensions|viewRegistry|registerExtensions\(\s*\[[^\]]*['"]md['"]/,
      );
      expect(code).not.toMatch(/['"]md['"]/);
      expect(code).not.toMatch(
        /metadataCache\.getFirstLinkpathDest\s*=|resolveLinks|registerMarkdownPostProcessor|registerEditorExtension/,
      );
    }
  });

  it('collects labels and macros from the open file for completion', () => {
    const k = fileKnowledge(() => '\\newcommand{\\R}{\\mathbb{R}}\\section{A}\\label{sec:a}');
    expect(k.labels()).toEqual(['sec:a']);
    expect([...k.macros().keys()]).toEqual(['R']);
    expect(k.citekeys()).toBeNull();
  });
});
