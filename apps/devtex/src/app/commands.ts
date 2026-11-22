/**
 * Command registry: the single id space used by the macOS menu (Rust),
 * keymap.json, toolbars.json and the command palette.
 */

export interface CommandDef {
  id: string;
  title: string;
  run: () => void | Promise<void>;
  /** Hidden from palette/toolbars on platforms where it does nothing. */
  available?: () => boolean;
}

export class CommandRegistry {
  private readonly defs = new Map<string, CommandDef>();

  register(def: CommandDef): void {
    this.defs.set(def.id, def);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  ids(): Set<string> {
    return new Set(this.defs.keys());
  }

  list(): CommandDef[] {
    return [...this.defs.values()].filter((d) => d.available?.() !== false);
  }

  /** Registered and available on this platform. */
  isAvailable(id: string): boolean {
    const d = this.defs.get(id);
    return d !== undefined && d.available?.() !== false;
  }

  title(id: string): string {
    return this.defs.get(id)?.title ?? id;
  }

  /** Run a command; returns false when unknown or unavailable. */
  run(id: string): boolean {
    const d = this.defs.get(id);
    if (d === undefined || d.available?.() === false) return false;
    void Promise.resolve(d.run()).catch((e: unknown) =>
      console.error(`[DevTex] command ${id} failed`, e),
    );
    return true;
  }
}
