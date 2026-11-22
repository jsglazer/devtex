/** Minimal test double for the `obsidian` module (aliased in vitest.config.ts). */
export interface WorkspaceLeaf {
  id: string;
}

export const calls: { method: string; args: unknown[] }[] = [];

export class Plugin {
  registerView(type: string, factory: (leaf: WorkspaceLeaf) => unknown): void {
    calls.push({ method: 'registerView', args: [type, factory] });
  }
  registerExtensions(exts: string[], viewType: string): void {
    calls.push({ method: 'registerExtensions', args: [exts, viewType] });
  }
  onload(): void {}
}

export class TextFileView {
  data = '';
  file: { basename: string } | null = null;
  contentEl = { empty: () => undefined, addClass: () => undefined };
  constructor(public leaf: WorkspaceLeaf) {}
  requestSave(): void {
    calls.push({ method: 'requestSave', args: [] });
  }
}
