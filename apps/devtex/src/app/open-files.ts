/**
 * The files open as tabs. A project's buffers hold every .tex/.bib file (the
 * preview, labels and citations need them), but only files the user opened
 * get a tab: opening a folder shows its main document, opening a file from
 * Finder or File ▸ Open File… shows just that file.
 */
export class OpenFiles {
  private files: string[] = [];

  get list(): readonly string[] {
    return this.files;
  }

  has(path: string): boolean {
    return this.files.includes(path);
  }

  /** Add a tab (no-op when already open); new tabs go to the right. */
  add(path: string): void {
    if (!this.files.includes(path)) this.files.push(path);
  }

  /**
   * Close a tab. Returns the file to show next when `path` was the current
   * one (its right neighbour, else its left), `''` when no tab is left, and
   * `current` unchanged otherwise.
   */
  close(path: string, current: string): string {
    const i = this.files.indexOf(path);
    if (i === -1) return current;
    this.files.splice(i, 1);
    if (path !== current) return current;
    return this.files[i] ?? this.files[i - 1] ?? '';
  }

  /** Drop tabs whose files no longer exist (e.g. deleted on disk). */
  retain(exists: (path: string) => boolean): void {
    this.files = this.files.filter(exists);
  }

  clear(): void {
    this.files = [];
  }
}
