/**
 * Style profiles at run time: which profile is showing, loading its text
 * (copying a built-in into themes/ the first time it is used, never
 * overwriting a file already there), falling back to Default when a profile
 * is missing or unreadable, migrating pre-1.0.5 colour/font settings, and
 * the Settings dialog's overrides in themes/user.css.
 *
 * No DOM: the stylesheets are applied through the injected `StyleSink`, so
 * this is tested with in-memory fakes. Nothing here touches the editor, so
 * switching profiles never rebuilds or resets it.
 */
import {
  activeSlot,
  appendMigrated,
  DEFAULT_PROFILES,
  forcedAppearance,
  isValidProfileName,
  profileAppearance,
  profileFile,
  profileForSlot,
  profileNames,
  readManagedBlock,
  USER_CSS,
  writeManagedBlock,
  type Appearance,
  type LegacyStyle,
  type ProfileSlot,
} from '@devtex/core';

export interface ConfigStore {
  readConfig(name: string): Promise<string | null>;
  writeConfig(name: string, content: string): Promise<void>;
  listThemeFiles(): Promise<string[]>;
}

export interface StyleSink {
  /** Replace the profile layer's stylesheet text. */
  setProfile(css: string): void;
  /** Replace the user layer's stylesheet text (user.css). */
  setUser(css: string): void;
  /**
   * The active profile's own appearance (CSS `color-scheme`) and the native
   * window appearance to force (null = follow the system).
   */
  setAppearance(own: Appearance | null, forced: Appearance | null): void;
}

export interface ActiveProfile {
  /** The profile actually showing (after any fallback). */
  name: string;
  slot: ProfileSlot;
  css: string;
}

const errText = (e: unknown): string =>
  e instanceof Error
    ? e.message
    : typeof e === 'object' && e !== null && 'message' in e
      ? String(e.message)
      : String(e);

export class ProfileManager {
  /** Problems from the last apply (shown in Problems ▸ Config). */
  problems: string[] = [];
  /** Informational notes (e.g. migrated settings), shown as info. */
  notes: string[] = [];
  private active: ActiveProfile | null = null;
  private userCss: string | null = null;

  constructor(
    private readonly store: ConfigStore,
    private readonly sink: StyleSink,
    private readonly builtins: Readonly<Record<string, string>>,
  ) {}

  get current(): ActiveProfile | null {
    return this.active;
  }

  /** Built-in names plus every profile in themes/, sorted, de-duplicated. */
  async available(): Promise<string[]> {
    let files: string[] = [];
    try {
      files = await this.store.listThemeFiles();
    } catch {
      // listing failed: the built-ins are still selectable
    }
    return profileNames([...Object.keys(this.builtins).map(profileFile), ...files]);
  }

  /**
   * Text of profile `name`: from themes/, else the built-in (copied into
   * themes/ so it can be edited). Null when it exists nowhere.
   */
  private async read(name: string): Promise<string | null> {
    const file = profileFile(name);
    const text = await this.store.readConfig(file);
    if (text !== null) return text;
    const builtin = this.builtins[name];
    if (builtin === undefined) return null;
    try {
      // first use: copy so the user can edit it (only reached when the file is absent)
      await this.store.writeConfig(file, builtin);
    } catch (e) {
      this.problems.push(`${file}: could not copy the built-in profile (${errText(e)})`);
    }
    return builtin;
  }

  /** Load the slot's profile, falling back to that slot's Default. */
  async load(name: string, slot: ProfileSlot): Promise<ActiveProfile> {
    const fallback = DEFAULT_PROFILES[slot];
    if (isValidProfileName(name)) {
      try {
        const css = await this.read(name);
        if (css !== null) return { name, slot, css };
        this.problems.push(
          `${profileFile(name)}: style profile "${name}" not found (using ${fallback})`,
        );
      } catch (e) {
        this.problems.push(
          `${profileFile(name)}: could not be read (${errText(e)}); using ${fallback}`,
        );
      }
    } else {
      this.problems.push(`ui: "${name}" is not a valid style profile name (using ${fallback})`);
    }
    let css: string | null = null;
    if (name !== fallback) {
      try {
        css = await this.read(fallback);
      } catch {
        // unreadable Default on disk: the built-in below never fails
      }
    }
    return { name: fallback, slot, css: css ?? this.builtins[fallback] ?? '' };
  }

  /** Show the profile for the current system appearance, plus user.css. */
  async apply(
    ui: { theme: string; themeDark: string },
    systemDark: boolean,
  ): Promise<ActiveProfile> {
    this.problems = [];
    const slot = activeSlot(systemDark);
    const p = await this.load(profileForSlot(ui, slot), slot);
    // a stale apply must not win over a newer one: commit both sheets together
    let user: string | null = null;
    try {
      user = await this.store.readConfig(USER_CSS);
    } catch (e) {
      this.problems.push(`${USER_CSS}: could not be read (${errText(e)})`);
    }
    this.active = p;
    this.userCss = user;
    // the built-in Default for the slot sits underneath, so a minimal profile
    // that sets only a few variables still gets every other one
    const floor = this.builtins[DEFAULT_PROFILES[slot]] ?? '';
    this.sink.setProfile(p.css === floor ? p.css : `${floor}\n/* ---- ${p.name} ---- */\n${p.css}`);
    this.sink.setUser(user ?? '');
    this.sink.setAppearance(profileAppearance(p.css), forcedAppearance(p.css, systemDark));
    return p;
  }

  /** True when a changed config name (from the theme watcher) affects what is showing. */
  affects(changed: readonly string[]): boolean {
    const name = this.active?.name;
    return changed.some((c) => c === USER_CSS || (name !== undefined && c === profileFile(name)));
  }

  /**
   * One-time migration of the pre-1.0.5 `colors` and `editor` font keys into
   * the Default profiles. Profiles already in themes/ are never overwritten.
   */
  async migrate(legacy: LegacyStyle | null): Promise<string[]> {
    if (legacy === null) return [];
    const written: string[] = [];
    const skipped: string[] = [];
    for (const name of [DEFAULT_PROFILES.light, DEFAULT_PROFILES.dark]) {
      const file = profileFile(name);
      if ((await this.store.readConfig(file)) !== null) {
        skipped.push(file);
        continue;
      }
      await this.store.writeConfig(file, appendMigrated(this.builtins[name] ?? '', legacy.vars));
      written.push(file);
    }
    const into = written.length > 0 ? written.join(' and ') : 'no file';
    const note = `settings.jsonc: ${legacy.keys.join(', ')} moved to ${into}${skipped.length > 0 ? ` (${skipped.join(', ')} already existed and was left unchanged)` : ''}. Style now lives in themes/*.css.`;
    this.notes = [note];
    return written;
  }

  /** The Settings dialog's current overrides (the managed block of user.css). */
  async overrides(): Promise<Map<string, string>> {
    return readManagedBlock(this.userCss ?? (await this.store.readConfig(USER_CSS)));
  }

  /**
   * Save the Settings dialog's overrides into user.css's managed block,
   * leaving the rest of user.css and every profile file untouched.
   */
  async saveOverrides(vars: ReadonlyMap<string, string>): Promise<void> {
    const current = await this.store.readConfig(USER_CSS);
    const next = writeManagedBlock(current, vars);
    await this.store.writeConfig(USER_CSS, next);
    this.userCss = next;
    this.sink.setUser(next);
  }
}
