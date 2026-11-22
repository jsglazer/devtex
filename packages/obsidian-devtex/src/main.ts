/**
 * DevTex companion plugin for Obsidian.
 *
 * Registers ONLY the `tex` extension with a dedicated TextFileView backed by
 * @devtex/cm-latex. It never registers or unregisters `md`, and it does not
 * touch the link resolver: [[chapter.tex]] links rely on Obsidian's native
 * non-Markdown link resolution, which opens the file in this view.
 * Uses public plugin APIs only (no Obsidian internals).
 */
import { Plugin, type WorkspaceLeaf } from 'obsidian';
import { TexView, VIEW_TYPE_TEX } from './tex-view.js';

/** The only extensions this plugin registers. Must never contain "md". */
export const TEX_EXTENSIONS = ['tex'] as const;

export default class DevTexPlugin extends Plugin {
  override onload(): void {
    this.registerView(VIEW_TYPE_TEX, (leaf: WorkspaceLeaf) => new TexView(leaf));
    this.registerExtensions([...TEX_EXTENSIONS], VIEW_TYPE_TEX);
  }
}
