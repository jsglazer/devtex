/**
 * Style profiles at run time. Profiles come from DevStyle's shared folder (on
 * macOS, the App Group container every app reads), so a style chosen in any
 * app applies here too. DevTex either follows that shared choice
 * (`ui.followSharedStyle`, the default) or uses its own `ui.theme` /
 * `ui.themeDark`. A missing or broken profile falls back to Default and is
 * reported in Problems. `themes/user.css` in DevTex's own config folder sits on
 * top of any profile.
 *
 * Also runs the one-time migrations: DevTex 1.0.4's style keys in
 * settings.jsonc, and DevTex 1.0.5–1.0.6's own profiles in themes/.
 *
 * No DOM: the stylesheets are applied through the injected `StyleSink`, and the
 * shared folder through a DevStyle `FolderHost`, so this is tested with
 * in-memory fakes. Nothing here touches the editor, so switching profiles never
 * rebuilds or resets it.
 */
import {
  BUILTIN_PROFILES,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  installBuiltins,
  listProfiles,
  loadProfile,
  parseConfig,
  parseProfile,
  profilePath,
  resolveProfileId,
  serializeConfig,
  type AppPreference,
  type FolderHost,
  type ParsedProfile,
  type ProfileInfo,
  type SharedConfig,
} from '@devstyle/web';
import {
  activeSlot,
  changedLegacyVars,
  DEFAULT_PROFILES,
  forcedAppearance,
  isProfileId,
  legacyNameToId,
  LEGACY_BUILTIN_HASHES,
  legacyProfileName,
  migrateProfileSetting,
  planLegacyMigration,
  profileForSlot,
  readManagedBlock,
  USER_CSS,
  writeManagedBlock,
  type Appearance,
  type LegacyProfileFile,
  type LegacyStyle,
  type ProfileSlot,
} from '@devtex/core';

export interface ConfigStore {
  readConfig(name: string): Promise<string | null>;
  writeConfig(name: string, content: string): Promise<void>;
  listThemeFiles(): Promise<string[]>;
  deleteThemeFile(name: string): Promise<void>;
}

export interface StyleSink {
  /** Replace the DevStyle profile layer's stylesheet text. */
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
  /** DevStyle id of the profile actually showing (after any fallback). */
  id: string;
  /** Its display name (from the profile header). */
  name: string;
  slot: ProfileSlot;
  css: string;
}

/** The `ui` settings that choose a profile. */
export interface StyleChoice {
  followSharedStyle: boolean;
  theme: string;
  themeDark: string;
}

const errText = (e: unknown): string =>
  e instanceof Error
    ? e.message
    : typeof e === 'object' && e !== null && 'message' in e
      ? String(e.message)
      : String(e);

/** The built-in profile for a slot; DevStyle always ships both Defaults. */
function builtinDefault(slot: ProfileSlot): ParsedProfile {
  const id = DEFAULT_PROFILES[slot];
  return {
    id,
    header: {
      name: slot === 'dark' ? 'Default Dark' : 'Default Light',
      appearance: slot,
      pair: '',
    },
    values: {},
    css: BUILTIN_PROFILES[id] ?? '',
    issues: [],
  };
}

export class ProfileManager {
  /** Problems from the last apply (shown in Problems ▸ Config). */
  problems: string[] = [];
  /** Informational notes (e.g. migrated settings), shown as info. */
  notes: string[] = [];
  private active: ActiveProfile | null = null;
  private userCss: string | null = null;
  private installProblems: string[] = [];

  /**
   * @param host DevStyle's shared folder, or null where there is none (iOS):
   *   then only the built-in profiles and DevTex's own choice are used.
   */
  constructor(
    private readonly store: ConfigStore,
    private readonly host: FolderHost | null,
    private readonly sink: StyleSink,
  ) {}

  get current(): ActiveProfile | null {
    return this.active;
  }

  /** True when there is a shared folder to follow (macOS). */
  get canShare(): boolean {
    return this.host !== null;
  }

  /** Copy DevStyle's built-in profiles and devstyle.json into the shared folder; never overwrites. */
  async install(): Promise<string[]> {
    this.installProblems = [];
    if (this.host === null) return [];
    try {
      return await installBuiltins(this.host);
    } catch (e) {
      this.installProblems.push(
        `DevStyle folder: could not install the built-in profiles (${errText(e)}); using the copies inside DevTex`,
      );
      return [];
    }
  }

  /** Every selectable profile: the shared folder's plus any built-in it lacks, sorted by name. */
  async available(): Promise<ProfileInfo[]> {
    try {
      return await listProfiles(this.host);
    } catch {
      // folder unreadable: the built-ins are still selectable
      return listProfiles(null);
    }
  }

  /** The style every app follows (devstyle.json), or the defaults without a shared folder. */
  async sharedChoice(): Promise<SharedConfig> {
    if (this.host === null) return DEFAULT_CONFIG;
    try {
      return parseConfig(await this.host.read(CONFIG_FILE)).config;
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  /** Change the style for every app that follows the shared choice. */
  async setShared(light: string, dark: string): Promise<void> {
    if (this.host === null) throw new Error('there is no shared DevStyle folder on this device');
    if (!isProfileId(light) || !isProfileId(dark)) throw new Error('not a profile id');
    await this.host.write(CONFIG_FILE, serializeConfig({ version: 1, light, dark }));
  }

  /** The profile id the current settings pick for a slot. */
  async chosen(ui: StyleChoice, slot: ProfileSlot): Promise<string> {
    const pref = this.preference(ui);
    return resolveProfileId(await this.sharedChoice(), pref, slot);
  }

  private preference(ui: StyleChoice): AppPreference {
    return ui.followSharedStyle && this.host !== null
      ? { follow: true }
      : { follow: false, light: profileForSlot(ui, 'light'), dark: profileForSlot(ui, 'dark') };
  }

  /** Show the profile for the current system appearance, plus user.css. */
  async apply(ui: StyleChoice, systemDark: boolean): Promise<ActiveProfile> {
    const problems = [...this.installProblems];
    const slot = activeSlot(systemDark);
    let host = this.host;
    let config = DEFAULT_CONFIG;
    if (host !== null) {
      try {
        const r = parseConfig(await host.read(CONFIG_FILE));
        config = r.config;
        problems.push(...r.issues.map((i) => `DevStyle ${i}`));
      } catch (e) {
        problems.push(
          `DevStyle folder: could not be read (${errText(e)}); using the built-in profiles`,
        );
        host = null;
      }
    }
    const id = resolveProfileId(config, this.preference(ui), slot);
    let profile: ParsedProfile | null = null;
    try {
      profile = await loadProfile(host, id);
    } catch (e) {
      problems.push(`DevStyle ${profilePath(id)}: could not be read (${errText(e)})`);
      profile = await loadProfile(null, id);
    }
    if (profile === null) {
      problems.push(
        `DevStyle ${profilePath(id)}: style profile "${id}" not found (using ${DEFAULT_PROFILES[slot]})`,
      );
      profile = (await loadProfile(null, DEFAULT_PROFILES[slot])) ?? builtinDefault(slot);
    }
    problems.push(...profile.issues.map((i) => `DevStyle ${profilePath(profile.id)}: ${i}`));
    // a stale apply must not win over a newer one: commit both sheets together
    let user: string | null = null;
    try {
      user = await this.store.readConfig(USER_CSS);
    } catch (e) {
      problems.push(`${USER_CSS}: could not be read (${errText(e)})`);
    }
    this.problems = problems;
    const active: ActiveProfile = {
      id: profile.id,
      name: profile.header?.name ?? profile.id,
      slot,
      css: profile.css,
    };
    this.active = active;
    this.userCss = user;
    // the built-in Default for the slot sits underneath, so a profile that sets
    // only a few tokens (or a converted DevTex one) still gets every other one
    const floor = BUILTIN_PROFILES[DEFAULT_PROFILES[slot]] ?? '';
    this.sink.setProfile(
      profile.css === floor ? floor : `${floor}\n/* ---- ${profile.id} ---- */\n${profile.css}`,
    );
    this.sink.setUser(user ?? '');
    const own = profile.header?.appearance ?? null;
    this.sink.setAppearance(own, forcedAppearance(own, systemDark));
    return active;
  }

  /** True when a changed DevTex config name (from the themes/ watcher) affects what is showing. */
  affects(changed: readonly string[]): boolean {
    return changed.includes(USER_CSS);
  }

  /**
   * One-time migration of DevTex 1.0.4's `colors` and `editor` font keys.
   * Values the user changed go into user.css's managed block (merged with any
   * overrides already there); values still at the old defaults are dropped.
   */
  async migrate(legacy: LegacyStyle | null): Promise<void> {
    if (legacy === null) return;
    const changed = changedLegacyVars(legacy.vars);
    if (changed.size > 0) {
      const current = await this.store.readConfig(USER_CSS);
      const merged = new Map([...readManagedBlock(current), ...changed]);
      await this.store.writeConfig(USER_CSS, writeManagedBlock(current, merged));
    }
    this.notes.push(
      `settings.jsonc: ${legacy.keys.join(', ')} removed${changed.size > 0 ? ` (your values moved to ${USER_CSS})` : ' (they were at their defaults)'}. Style now comes from DevStyle profiles.`,
    );
  }

  /**
   * One-time move from DevTex 1.0.5–1.0.6's own profiles to DevStyle. Untouched
   * copies are deleted; edited or user-made ones become DevStyle profiles in the
   * shared folder (never overwriting a file there) and are then deleted from
   * themes/. Returns the updated choice, or null when there was nothing to do.
   */
  async migrateThemes(ui: StyleChoice): Promise<StyleChoice | null> {
    let files: string[] = [];
    try {
      files = await this.store.listThemeFiles();
    } catch {
      // nothing listable: only the settings are converted
    }
    const legacy: LegacyProfileFile[] = [];
    for (const file of files) {
      const name = legacyProfileName(file);
      if (name === null) continue;
      const css = await this.store.readConfig(file).catch(() => null);
      if (css !== null) legacy.push({ file, name, css });
    }
    if (legacy.length === 0 && isProfileId(ui.theme) && isProfileId(ui.themeDark)) return null;
    const builtinValues = Object.fromEntries(
      Object.entries(BUILTIN_PROFILES).map(([id, css]) => [id, parseProfile(id, css).values]),
    );
    const plan = planLegacyMigration(legacy, builtinValues);
    const moved: string[] = [];
    const kept: string[] = [];
    const remove = async (file: string): Promise<void> => {
      try {
        await this.store.deleteThemeFile(file);
      } catch (e) {
        this.notes.push(`${file}: could not be deleted after the move (${errText(e)})`);
      }
    };
    const converted = new Set(plan.writes.map((w) => w.from));
    for (const file of plan.deletes) if (!converted.has(file)) await remove(file);
    for (const w of plan.writes) {
      const name = legacyProfileName(w.from) ?? w.from;
      const fallback =
        name in LEGACY_BUILTIN_HASHES
          ? legacyNameToId(name)
          : /\bDark$/.test(name)
            ? DEFAULT_PROFILES.dark
            : DEFAULT_PROFILES.light;
      if (this.host === null) {
        // no shared folder (iOS): keep the file, show the built-in instead
        plan.ids.set(name, fallback);
        kept.push(w.from);
        continue;
      }
      try {
        const path = profilePath(w.id);
        if ((await this.host.read(path)) === null) await this.host.write(path, w.css);
        moved.push(`${w.from} → DevStyle ${path}`);
        await remove(w.from);
      } catch (e) {
        plan.ids.set(name, fallback);
        kept.push(w.from);
        this.notes.push(
          `${w.from}: could not be copied to DevStyle (${errText(e)}); left in place`,
        );
      }
    }
    const next: StyleChoice = {
      followSharedStyle: ui.followSharedStyle,
      theme: migrateProfileSetting(ui.theme, plan.ids, 'light'),
      themeDark: migrateProfileSetting(ui.themeDark, plan.ids, 'dark'),
    };
    // keep showing a profile the user edited: follow it here rather than the shared style
    const usesConverted = [next.theme, next.themeDark].some((id) => id.endsWith('-devtex'));
    if (usesConverted && this.host !== null) next.followSharedStyle = false;
    const parts = ['Style profiles now come from DevStyle, shared by all apps.'];
    if (moved.length > 0) parts.push(`Moved your edited profiles: ${moved.join('; ')}.`);
    if (usesConverted && this.host !== null)
      parts.push('DevTex keeps using them ("Use my own" in Settings); other apps are unchanged.');
    if (kept.length > 0) parts.push(`Not moved (no shared folder here): ${kept.join(', ')}.`);
    this.notes.push(`themes/: ${parts.join(' ')}`);
    return next;
  }

  /** The Settings dialog's current overrides (the managed block of user.css). */
  async overrides(): Promise<Map<string, string>> {
    return readManagedBlock(this.userCss ?? (await this.store.readConfig(USER_CSS)));
  }

  /**
   * Save the Settings dialog's overrides into user.css's managed block,
   * leaving the rest of user.css and every profile untouched.
   */
  async saveOverrides(vars: ReadonlyMap<string, string>): Promise<void> {
    const current = await this.store.readConfig(USER_CSS);
    const next = writeManagedBlock(current, vars);
    await this.store.writeConfig(USER_CSS, next);
    this.userCss = next;
    this.sink.setUser(next);
  }
}
