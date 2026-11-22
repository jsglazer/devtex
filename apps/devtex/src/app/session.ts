/**
 * Project session: file buffers, root resolution, guarded saves and the
 * external-change policy. No DOM and no Tauri imports — it talks to the
 * injected ProjectFileSystem and asks the injected Prompter on conflicts, so
 * it is fully testable with in-memory fakes.
 *
 * Save rule: EVERY write goes through fs.saveGuarded with the stamp the
 * buffer was last loaded/saved with. A mismatch (Rust re-checks mtime +
 * SHA-256) becomes a conflict prompt; nothing is overwritten silently.
 */
import {
  bibResources,
  collectMacros,
  decideExternalChange,
  dirname,
  includeClosure,
  joinPath,
  labelsOf,
  lineDiff,
  parseBibtex,
  projectOutline,
  resolveRoot,
  type BibEntry,
  type ConflictChoice,
  type DiffLine,
  type FileStamp,
  type MacroSet,
  type OutlineItem,
  type ProjectFileSystem,
  type RootResolution,
} from '@devtex/core';

export interface Buffer {
  path: string;
  /** Text as last loaded from or saved to disk. */
  diskText: string;
  /** Current editor text. */
  text: string;
  stamp: FileStamp | null;
}

export interface Prompter {
  /** Disk changed while the buffer has unsaved edits. */
  conflict(path: string, diff: DiffLine[]): Promise<ConflictChoice>;
  notice(text: string): void;
}

export interface SessionEvents {
  /** A buffer's text was replaced from disk (reload). */
  reloaded(path: string, text: string): void;
  /** The set of files or their contents changed (for preview/outline refresh). */
  changed(paths: string[]): void;
}

export type SaveOutcome = 'saved' | 'unchanged' | 'kept-mine' | 'loaded-disk' | 'cancelled';

export class ProjectSession {
  readonly buffers = new Map<string, Buffer>();
  private allPaths: string[] = [];
  private bib: BibEntry[] = [];

  constructor(
    private readonly fs: ProjectFileSystem,
    private readonly prompter: Prompter,
    private readonly events: SessionEvents,
  ) {}

  /** Load every .tex/.bib file of the project into buffers. */
  async load(): Promise<void> {
    this.buffers.clear();
    this.allPaths = await this.fs.list();
    for (const p of this.allPaths) {
      const r = await this.fs.read(p);
      this.buffers.set(p, { path: p, diskText: r.text, text: r.text, stamp: r.stamp });
    }
    this.reparseBib();
    this.events.changed([...this.buffers.keys()]);
  }

  paths(): string[] {
    return [...this.buffers.keys()].sort();
  }

  texPaths(): string[] {
    return this.paths().filter((p) => p.endsWith('.tex'));
  }

  isDirty(path: string): boolean {
    const b = this.buffers.get(path);
    return b !== undefined && b.text !== b.diskText;
  }

  dirtyPaths(): string[] {
    return this.paths().filter((p) => this.isDirty(p));
  }

  /** Current texts (including unsaved edits) as a FileMap for core functions. */
  snapshot(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [p, b] of this.buffers) m.set(p, b.text);
    return m;
  }

  setText(path: string, text: string): void {
    const b = this.buffers.get(path);
    if (b === undefined) return;
    b.text = text;
    if (path.endsWith('.bib')) this.reparseBib();
  }

  rootFor(path: string): RootResolution {
    return resolveRoot(path, this.snapshot());
  }

  /** Root plus all included files, in document order. */
  projectFiles(root: string): string[] {
    return includeClosure(root, this.snapshot());
  }

  outline(root: string): OutlineItem[] {
    return projectOutline(this.projectFiles(root), (f) => this.buffers.get(f)?.text);
  }

  labels(root: string): string[] {
    return labelsOf(this.outline(root));
  }

  macros(root: string): MacroSet {
    return collectMacros(this.projectFiles(root).map((f) => this.buffers.get(f)?.text ?? ''));
  }

  /** Entries from .bib files referenced by the project (or all .bib files when none are referenced). */
  bibEntries(): BibEntry[] {
    return this.bib;
  }

  private reparseBib(): void {
    const referenced = new Set<string>();
    for (const p of this.texPaths()) {
      for (const r of bibResources(this.buffers.get(p)?.text ?? ''))
        referenced.add(joinPath(dirname(p), r));
    }
    const bibs = this.paths().filter(
      (p) =>
        p.endsWith('.bib') &&
        (referenced.size === 0 ||
          referenced.has(p) ||
          [...referenced].some((r) => r.endsWith(`/${p}`) || p.endsWith(r))),
    );
    this.bib = bibs.flatMap((p) => parseBibtex(this.buffers.get(p)?.text ?? ''));
  }

  /** Save one buffer through the guarded write; prompts on conflict. */
  async save(path: string): Promise<SaveOutcome> {
    const b = this.buffers.get(path);
    if (b === undefined) return 'cancelled';
    if (b.text === b.diskText && b.stamp !== null) return 'unchanged';
    const r = await this.fs.saveGuarded(path, b.text, b.stamp);
    if (r.ok) {
      b.diskText = b.text;
      b.stamp = r.stamp;
      return 'saved';
    }
    return this.resolveConflict(b, true);
  }

  async saveAll(): Promise<Map<string, SaveOutcome>> {
    const out = new Map<string, SaveOutcome>();
    for (const p of this.dirtyPaths()) out.set(p, await this.save(p));
    return out;
  }

  /**
   * Write new text for a file that may not be open in the editor (e.g. the
   * pushed stamp). Uses the same guarded path.
   */
  async writeFile(path: string, text: string): Promise<SaveOutcome> {
    const b = this.buffers.get(path);
    if (b === undefined) return 'cancelled';
    b.text = text;
    const outcome = await this.save(path);
    if (outcome === 'saved') this.events.reloaded(path, text);
    return outcome;
  }

  private async resolveConflict(b: Buffer, saving: boolean): Promise<SaveOutcome> {
    const disk = await this.fs.stat(b.path);
    const diskText = disk === null ? '' : (await this.fs.read(b.path)).text;
    for (;;) {
      const choice = await this.prompter.conflict(b.path, lineDiff(b.text, diskText));
      if (choice === 'showDiff') continue; // the prompter shows the diff and asks again
      if (choice === 'loadDisk') {
        if (disk === null) {
          this.prompter.notice(`${b.path} was deleted on disk; keeping your text unsaved.`);
          b.stamp = null;
          b.diskText = '';
          return 'cancelled';
        }
        const fresh = await this.fs.read(b.path);
        b.text = fresh.text;
        b.diskText = fresh.text;
        b.stamp = fresh.stamp;
        this.events.reloaded(b.path, fresh.text);
        this.events.changed([b.path]);
        return 'loaded-disk';
      }
      // keepMine: adopt the disk stamp so the next save is an explicit overwrite of what we just showed
      b.stamp = disk;
      b.diskText = diskText;
      if (!saving) return 'kept-mine';
      const r = await this.fs.saveGuarded(b.path, b.text, disk);
      if (r.ok) {
        b.diskText = b.text;
        b.stamp = r.stamp;
        return 'saved';
      }
      // changed yet again in between: loop with a fresh prompt
      return this.resolveConflict(b, saving);
    }
  }

  /**
   * Re-stamp files after a watcher event, on app foreground, or on the iOS
   * 5 s poll. Clean buffers reload silently; dirty ones prompt. `paths`
   * containing "*" (watcher rescan) or omitted means all buffers.
   */
  async checkExternal(paths?: readonly string[]): Promise<void> {
    const targets = paths === undefined || paths.includes('*') ? this.paths() : paths;
    const changed: string[] = [];
    for (const p of targets) {
      const b = this.buffers.get(p);
      if (b === undefined) {
        if (/\.(tex|bib)$/.test(p) && (await this.fs.stat(p)) !== null) {
          const r = await this.fs.read(p);
          this.buffers.set(p, { path: p, diskText: r.text, text: r.text, stamp: r.stamp });
          changed.push(p);
        }
        continue;
      }
      const disk = await this.fs.stat(p);
      const known = b.stamp ?? { mtimeMs: 0, hash: '' };
      const action = decideExternalChange(known, disk, this.isDirty(p));
      if (action.kind === 'none') continue;
      if (action.kind === 'reload') {
        const r = await this.fs.read(p);
        b.text = r.text;
        b.diskText = r.text;
        b.stamp = r.stamp;
        this.events.reloaded(p, r.text);
        changed.push(p);
      } else if (action.kind === 'conflict') {
        const outcome = await this.resolveConflict(b, false);
        if (outcome === 'loaded-disk') changed.push(p);
      } else {
        this.prompter.notice(
          `${p} was deleted or moved on disk.${action.dirty ? ' Your unsaved text is kept.' : ''}`,
        );
        b.stamp = null;
        b.diskText = '';
      }
    }
    if (changed.some((p) => p.endsWith('.bib'))) this.reparseBib();
    if (changed.length > 0) this.events.changed(changed);
  }
}
