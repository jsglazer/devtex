/**
 * DevTex app controller: wires the shell, project session, editor, preview
 * worker, PDF pane, commands and config together.
 */
import { startCompletion } from '@codemirror/autocomplete';
import { EditorSelection } from '@codemirror/state';
import { insertTemplate, wrapCommand, type ProjectKnowledge } from '@devtex/cm-latex';
import {
  BetterBibTexClient,
  bibLabel,
  diagnose,
  dirname,
  engineOf,
  loadKeymap,
  loadSettings,
  loadSyntaxFile,
  loadToolbars,
  PALETTE,
  parseLatexLog,
  parseMagicComments,
  pdfPathFor,
  serializeSettings,
  type BbtItem,
  type CitationInfo,
  type KeyBinding,
  type LogEntry,
  type PaletteGroup,
  type Settings,
  type SyntaxDefinition,
  type Toolbar,
} from '@devtex/core';
import type { PlatformInfo, ProjectInfo, Shell } from '../shell/types.js';
import { errorText } from '../shell/types.js';
import { CommandRegistry } from './commands.js';
import { CM_COMMANDS, SourceEditor } from './editor.js';
import {
  formatHud,
  problemsFromDiagnostics,
  problemsFromLog,
  renderAccessory,
  renderOutline,
  renderProblems,
  renderTabs,
  renderToolbars,
  type Problem,
} from './panels.js';
import { PdfPane } from './pdf.js';
import { PreviewPane } from './preview.js';
import { pushReview, submitVersion, type PushDeps } from './push-flow.js';
import { ProjectSession } from './session.js';
import { settingsDialog } from './settings-ui.js';
import {
  conflictDialog,
  confirmDialog,
  messageApproval,
  notice,
  pickDialog,
  proceedOrAbort,
  promptDialog,
} from './ui.js';

const $ = (id: string): HTMLElement => {
  const e = document.getElementById(id);
  if (e === null) throw new Error(`#${id} missing from index.html`);
  return e;
};

/** iOS: external-change poll interval while active (decision: every 5 s). */
export const IOS_POLL_MS = 5000;

export class App {
  private platform: PlatformInfo = {
    os: 'other',
    canCompile: false,
    canWatch: false,
    hasZotero: false,
  };
  private project: ProjectInfo | null = null;
  private session: ProjectSession;
  private editor!: SourceEditor;
  private preview!: PreviewPane;
  private pdf!: PdfPane;
  private readonly commands = new CommandRegistry();
  private settings: Settings = loadSettings(null).value;
  private bindings: KeyBinding[] = [];
  private toolbars: Toolbar[] = [];
  private syntax: SyntaxDefinition[] = [];
  private configErrors: string[] = [];
  private toolbarsHidden = false;
  private root = '';
  private logEntries: LogEntry[] = [];
  private bbt: BetterBibTexClient;
  private bbtReady = false;
  private readonly bbtSeen = new Map<string, BbtItem>();
  private bbtTimer: ReturnType<typeof setTimeout> | null = null;
  private problemsTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private compiling = false;

  constructor(private readonly shell: Shell) {
    this.session = new ProjectSession(
      shell.fs,
      {
        conflict: (path, diff) => conflictDialog(path, diff),
        notice: (t) => notice(t),
      },
      {
        reloaded: (path, text) => this.editor.replaceText(path, text),
        changed: () => this.projectChanged(),
      },
    );
    this.bbt = new BetterBibTexClient(shell.bbtTransport, {
      now: () => performance.now(),
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
  }

  private readonly knowledge: ProjectKnowledge = {
    labels: () => (this.root === '' ? [] : this.session.labels(this.root)),
    citations: (): CitationInfo[] => {
      const out = new Map<string, CitationInfo>();
      for (const e of this.session.bibEntries()) out.set(e.key, { key: e.key, label: bibLabel(e) });
      for (const it of this.bbtSeen.values())
        if (!out.has(it.citekey))
          out.set(it.citekey, {
            key: it.citekey,
            label: `${it.author} (${it.year}) ${it.title} — Zotero`,
          });
      return [...out.values()];
    },
    // With Zotero online the library cannot be enumerated, so unknown-key checks are skipped.
    citekeys: () => {
      if (this.bbtReady) return null;
      const bib = this.session.bibEntries();
      return bib.length === 0 ? null : new Set(bib.map((e) => e.key));
    },
    macros: () => (this.root === '' ? new Map() : this.session.macros(this.root)),
    external: () => this.externalDiagnostics(),
  };

  async start(): Promise<void> {
    this.platform = await this.shell.platform();
    document.body.dataset['platform'] = this.platform.os;
    await this.loadConfig();
    this.editor = new SourceEditor(
      $('editor'),
      {
        knowledge: this.knowledge,
        onChange: (path, text) => this.onEdit(path, text),
        onCursor: (path, line) => this.onCursor(path, line),
        runCommand: (id) => this.commands.run(id),
      },
      this.settings,
      this.bindings,
      this.syntax,
    );
    this.preview = new PreviewPane({
      container: $('preview'),
      debounceMs: this.settings.preview.debounceMs,
      onSourceClick: (file, line) => this.jumpTo(file, line),
      onTimings: (t, stats) => {
        $('status-hud').textContent = this.settings.preview.timingHud ? formatHud(t, stats) : '';
      },
    });
    this.pdf = new PdfPane($('pdf'), (file, line) => this.jumpTo(file, line));
    this.registerCommands();
    this.renderToolbars();
    this.wireRightTabs();
    await this.shell.onMenu((id) => {
      const local = CM_COMMANDS[id];
      if (local) local(this.editor.view);
      else this.commands.run(id);
    });
    await this.shell.onFsChanged((paths) => void this.session.checkExternal(paths));
    // foreground check (both platforms) and iOS polling
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.project) void this.session.checkExternal();
    });
    if (this.platform.os === 'ios') {
      setInterval(() => {
        if (document.visibilityState === 'visible' && this.project)
          void this.session.checkExternal();
      }, IOS_POLL_MS);
      const acc = $('accessory');
      acc.hidden = false;
      renderAccessory(acc, (s) => this.insertText(s), [
        { label: '⇥', run: () => this.insertText('  ') },
        { label: 'Sect', run: () => this.commands.run('palette.sectioning') },
        { label: 'Env', run: () => this.commands.run('palette.environments') },
      ]);
    }
    if (this.platform.hasZotero && this.settings.citations.betterBibTex) {
      const r = await this.bbt.ready();
      this.bbtReady = r.ok && r.value;
    }
    this.setStatus(
      this.platform.os === 'ios'
        ? 'Open your vault folder to begin.'
        : 'Open a project folder (File ▸ Open Project Folder…, ⌘O).',
    );
    this.renderProblems();
    if (this.platform.os === 'ios') {
      // the plugin already restored and started access in load(); open that vault folder
      const vault = await this.shell.restoreVault().catch(() => null);
      if (vault !== null) await this.openProject(vault);
    }
    if (typeof this.platform.initialProject === 'string')
      await this.openProject(this.platform.initialProject);
    if (typeof this.platform.initialCommands === 'string') {
      for (const id of this.platform.initialCommands.split(',')) {
        const local = CM_COMMANDS[id];
        if (local) local(this.editor.view);
        else this.commands.run(id.trim());
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  // ---------- config ----------

  private async loadConfig(): Promise<void> {
    const errors: string[] = [];
    const s = loadSettings(await this.shell.readConfig('settings.jsonc'));
    errors.push(...s.errors);
    this.settings = s.value;
    const k = loadKeymap(await this.shell.readConfig('keymap.json'));
    errors.push(...k.errors);
    this.bindings = k.value.bindings;
    const t = loadToolbars(await this.shell.readConfig('toolbars.json'));
    errors.push(...t.errors);
    this.toolbars = t.value;
    this.syntax = [];
    for (const name of await this.shell.listSyntaxFiles()) {
      const text = await this.shell.readConfig(name);
      if (text === null) continue;
      const def = loadSyntaxFile(name, text);
      errors.push(...def.errors);
      if (def.value !== null) this.syntax.push(def.value);
    }
    this.configErrors = errors;
    document.documentElement.style.setProperty(
      '--dt-env-pair',
      this.settings.colors.environmentPair,
    );
    document.documentElement.style.setProperty('--dt-broken', this.settings.colors.brokenCode);
    if (errors.length > 0)
      notice(
        `Config problems: ${errors.length} (see Problems). Defaults are used for invalid values.`,
      );
  }

  private async reloadConfig(): Promise<void> {
    await this.loadConfig();
    // unknown commands in keymap/toolbars can only be checked once commands exist
    const k = loadKeymap(await this.shell.readConfig('keymap.json'), this.commandIdsWithEditor());
    this.bindings = k.value.bindings;
    this.configErrors = [...new Set([...this.configErrors, ...k.errors])];
    this.editor.reconfigure(this.settings, this.bindings, this.syntax);
    this.preview.setDebounce(this.settings.preview.debounceMs);
    this.renderToolbars();
    this.renderProblems();
  }

  private commandIdsWithEditor(): Set<string> {
    const ids = this.commands.ids();
    for (const id of Object.keys(CM_COMMANDS)) ids.add(id);
    return ids;
  }

  // ---------- project ----------

  async openProject(path?: string): Promise<void> {
    const chosen = path ?? (await this.shell.pickFolder());
    if (chosen === null) return;
    if (this.project && this.session.dirtyPaths().length > 0) {
      const ok = await confirmDialog(
        'Unsaved changes',
        'Save changes before opening another project?',
        'Save',
        'Cancel',
      );
      if (!ok) return;
      await this.session.saveAll();
    }
    try {
      this.project = await this.shell.openProject(chosen);
    } catch (e) {
      notice(errorText(e));
      return;
    }
    this.preview.reset();
    await this.session.load();
    const tex = this.session.texPaths();
    const first = tex.find((p) => this.session.rootFor(p).source === 'self') ?? tex[0];
    if (first === undefined) {
      notice('No .tex files in this folder.');
      this.renderTabs();
      return;
    }
    this.openFile(first);
    await this.loadExistingPdf();
    this.setStatus(
      `${this.project.name}${this.project.vaultRoot === null ? '' : ` — vault: ${this.project.vaultRelative === '' ? '/' : this.project.vaultRelative}`}`,
    );
  }

  openFile(path: string): void {
    const b = this.session.buffers.get(path);
    if (!b) return;
    this.editor.open(path, b.text);
    this.root = this.session.rootFor(path).root;
    this.refreshPreview(true);
    this.renderTabs();
    this.renderOutline();
    this.renderProblems();
  }

  private jumpTo(file: string, line: number): void {
    if (!this.session.buffers.has(file)) return;
    if (this.editor.path !== file) this.openFile(file);
    this.editor.goTo(line);
  }

  private projectChanged(): void {
    if (!this.project) return;
    this.refreshPreview(false);
    this.renderOutline();
    this.renderTabs();
    this.scheduleProblems();
  }

  private onEdit(path: string, text: string): void {
    this.session.setText(path, text);
    this.refreshPreview(false);
    this.renderTabsSoon();
    this.scheduleProblems();
    this.maybeQueryZotero();
  }

  private onCursor(path: string, line: number): void {
    if (this.syncTimer !== null) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.preview.reveal(path, line), 150);
  }

  private refreshPreview(immediate: boolean): void {
    if (this.root === '') return;
    const files = new Map<string, string>();
    for (const f of this.session.projectFiles(this.root))
      files.set(f, this.session.buffers.get(f)?.text ?? '');
    this.preview.update(this.root, files, immediate);
  }

  private tabsTimer: ReturnType<typeof setTimeout> | null = null;
  private renderTabsSoon(): void {
    if (this.tabsTimer !== null) return;
    this.tabsTimer = setTimeout(() => {
      this.tabsTimer = null;
      this.renderTabs();
    }, 300);
  }

  private renderTabs(): void {
    const files =
      this.root === ''
        ? this.session.texPaths()
        : [...new Set([...this.session.projectFiles(this.root), ...this.session.texPaths()])];
    renderTabs(
      $('tabs'),
      files,
      this.editor.path,
      (f) => this.session.isDirty(f),
      (f) => this.openFile(f),
    );
  }

  private renderOutline(): void {
    const pane = $('outline');
    if (pane.hidden || this.root === '') return;
    renderOutline(pane, this.session.outline(this.root), (f, l) => this.jumpTo(f, l));
  }

  private scheduleProblems(): void {
    if (this.problemsTimer !== null) clearTimeout(this.problemsTimer);
    this.problemsTimer = setTimeout(() => this.renderProblems(), 500);
  }

  private renderProblems(): void {
    const pane = $('problems');
    const groups: { title: string; problems: Problem[] }[] = [];
    const path = this.editor.path;
    if (path !== '' && this.root !== '') {
      const text = this.session.buffers.get(path)?.text ?? '';
      const diags = diagnose(text, {
        labels: new Set(this.session.labels(this.root)),
        citekeys: this.knowledge.citekeys(),
      });
      groups.push({
        title: `Editor — ${path}`,
        problems: problemsFromDiagnostics(path, text, diags),
      });
    }
    groups.push({
      title: 'latexmk',
      problems: problemsFromLog(this.logEntries, (abs) => this.toRel(abs)),
    });
    groups.push({
      title: 'Config',
      problems: this.configErrors.map((m) => ({
        severity: 'warning',
        file: 'config',
        line: 0,
        message: m,
        source: 'config',
      })),
    });
    const errors = groups.flatMap((g) => g.problems).filter((p) => p.severity === 'error').length;
    $('status-right').textContent = errors > 0 ? `${errors} error(s)` : '';
    if (!pane.hidden) renderProblems(pane, groups, (f, l) => this.jumpTo(f, l));
  }

  private toRel(abs: string): string | null {
    const root = this.project?.root;
    if (root === undefined) return null;
    return abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : null;
  }

  /** latexmk entries for the current file, as editor diagnostics. */
  private externalDiagnostics(): {
    from: number;
    to: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
  }[] {
    const path = this.editor.path;
    const doc = this.editor.view.state.doc;
    return this.logEntries
      .filter((e) => this.toRel(e.file) === path && e.line >= 1 && e.line <= doc.lines)
      .map((e) => {
        const l = doc.line(e.line);
        return {
          from: l.from,
          to: Math.max(l.to, l.from + 1),
          severity: e.type === 'error' ? 'error' : e.type === 'info' ? 'info' : 'warning',
          message: `latexmk: ${e.text.trim()}`,
        };
      });
  }

  private maybeQueryZotero(): void {
    if (!this.platform.hasZotero || !this.settings.citations.betterBibTex) return;
    const st = this.editor.view.state;
    const head = st.selection.main.head;
    const line = st.doc.lineAt(head);
    const m = /\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\]){0,2}\{([^}]*)$/.exec(
      line.text.slice(0, head - line.from),
    );
    if (!m || m[1] === undefined) return;
    const word = m[1].slice(m[1].lastIndexOf(',') + 1).trim();
    if (word.length < 2 || this.bbt.cached(word) !== undefined) return;
    if (this.bbtTimer !== null) clearTimeout(this.bbtTimer);
    this.bbtTimer = setTimeout(() => {
      void this.bbt.search(word).then((r) => {
        if (!r.ok) return;
        this.bbtReady = true;
        for (const it of r.value) this.bbtSeen.set(it.citekey, it);
        if (r.value.length > 0) startCompletion(this.editor.view);
      });
    }, 150);
  }

  // ---------- compile / pdf ----------

  private async compile(): Promise<void> {
    if (!this.platform.canCompile) {
      notice('PDF compile is available on macOS only.');
      return;
    }
    if (this.root === '' || this.compiling) return;
    await this.session.saveAll();
    this.compiling = true;
    this.setStatus('Compiling…');
    try {
      const magic = parseMagicComments(this.session.buffers.get(this.root)?.text ?? '');
      const out = await this.shell.compile(
        this.root,
        engineOf(magic),
        this.settings.compile.latexmkPath,
      );
      const rootAbs = `${this.project?.root ?? ''}/${this.root}`;
      this.logEntries = parseLatexLog(out.log, rootAbs, {
        badBoxes: this.settings.compile.badBoxes,
      });
      const errs = this.logEntries.filter((e) => e.type === 'error').length;
      this.setStatus(
        out.ok
          ? `PDF built${errs > 0 ? ` with ${errs} error(s)` : ''}.`
          : `Compile failed (${errs} error(s)).`,
      );
      if (out.pdf !== null) await this.loadPdf(out.synctex);
      if (!out.ok) this.showPane('problems', true);
    } catch (e) {
      notice(errorText(e));
      this.setStatus('Compile failed.');
    } finally {
      this.compiling = false;
      this.renderProblems();
    }
  }

  private async loadExistingPdf(): Promise<void> {
    if (this.root === '') return;
    if ((await this.shell.fs.stat(pdfPathFor(this.root))) !== null) await this.loadPdf(null);
  }

  private async loadPdf(synctexPath: string | null): Promise<void> {
    if (!this.project) return;
    try {
      const bytes = await this.shell.fs.readBytes(pdfPathFor(this.root));
      const syn =
        synctexPath === null ? null : await this.shell.readSynctex(synctexPath).catch(() => null);
      const dir = dirname(this.root);
      const base = dir === '.' ? this.project.root : `${this.project.root}/${dir}`;
      await this.pdf.load(bytes, syn, base, this.project.root);
      if (synctexPath !== null) this.selectRight('pdf');
    } catch (e) {
      notice(`Could not show the PDF: ${errorText(e)}`);
    }
  }

  // ---------- push ----------

  private pushDeps(): PushDeps {
    return {
      session: this.session,
      dialogs: {
        repoFolder: (s) =>
          promptDialog(
            'Repo folder',
            'Folder in the papers repo for this paper (saved as % !DevTex git = …):',
            s,
          ),
        token: () =>
          promptDialog(
            'GitHub token',
            'Fine-grained personal access token for the papers repo (stored in the Keychain as github-papers-token):',
            '',
            { secret: true, okLabel: 'Save' },
          ),
        approveMessage: (m, files) => messageApproval(m, files),
        proceedOrAbort: (t) => proceedOrAbort('Submit version', t),
        confirm: (t) => confirmDialog('Confirm', t, 'Overwrite', 'Cancel'),
        notice: (t) => notice(t, 8000),
      },
      stat: (p) => this.shell.fs.stat(p),
      hasToken: () => this.shell.hasToken(),
      setToken: (t) => this.shell.setToken(t),
      push: (e, m, a) => this.shell.push(e, m, a),
      localTime: () => this.shell.localTime(),
      vaultRelative: this.project?.vaultRelative ?? null,
    };
  }

  // ---------- commands ----------

  private insertText(s: string): void {
    const v = this.editor.view;
    v.dispatch(v.state.replaceSelection(s));
    v.focus();
  }

  private async palette(group?: PaletteGroup['id']): Promise<void> {
    const groups = group === undefined ? PALETTE : PALETTE.filter((g) => g.id === group);
    const items = groups.flatMap((g) =>
      g.items.map((it, i) => ({
        label: it.label,
        detail: `${g.title}${it.detail !== undefined ? ` · ${it.detail}` : ''}`,
        value: `${g.id}:${i}`,
      })),
    );
    if (group === undefined)
      for (const c of this.commands.list())
        items.push({ label: c.title, detail: 'Command', value: `cmd:${c.id}` });
    const pick = await pickDialog(
      group === undefined ? 'Command palette' : (groups[0]?.title ?? ''),
      items,
    );
    if (pick === null) return;
    if (pick.startsWith('cmd:')) {
      this.commands.run(pick.slice(4));
      return;
    }
    const [gid, idx] = pick.split(':');
    const item = PALETTE.find((g) => g.id === gid)?.items[Number(idx)];
    if (item) {
      insertTemplate(this.editor.view, item.insert);
      this.editor.view.focus();
    }
  }

  private showPane(id: 'outline' | 'problems', force?: boolean): void {
    const pane = $(id);
    pane.hidden = force === undefined ? !pane.hidden : !force;
    if (!pane.hidden) {
      if (id === 'outline') this.renderOutline();
      else this.renderProblems();
    }
  }

  private selectRight(which: 'preview' | 'pdf'): void {
    $('preview').hidden = which !== 'preview';
    $('pdf').hidden = which !== 'pdf';
    for (const b of document.querySelectorAll<HTMLElement>('#right-tabs button'))
      b.classList.toggle('active', b.dataset['right'] === which);
    $('right-pane').hidden = false;
  }

  private wireRightTabs(): void {
    for (const b of document.querySelectorAll<HTMLElement>('#right-tabs button')) {
      b.addEventListener('click', () =>
        this.selectRight(b.dataset['right'] === 'pdf' ? 'pdf' : 'preview'),
      );
    }
  }

  private renderToolbars(): void {
    renderToolbars($('toolbars'), this.toolbars, this.commands, this.toolbarsHidden);
  }

  private setStatus(t: string): void {
    $('status-left').textContent = t;
  }

  private registerCommands(): void {
    const c = this.commands;
    const ed = (): SourceEditor => this.editor;
    const hasRoot = (): boolean => this.root !== '';
    c.register({
      id: 'file.openProject',
      title: 'Open Project Folder…',
      run: () => this.openProject(),
    });
    c.register({
      id: 'file.save',
      title: 'Save',
      run: async () => {
        const p = ed().path;
        if (p === '') return;
        const r = await this.session.save(p);
        if (r === 'saved') this.setStatus(`Saved ${p}`);
        this.renderTabs();
      },
    });
    c.register({
      id: 'format.bold',
      title: 'Bold',
      run: () => void wrapCommand('textbf')(ed().view),
    });
    c.register({
      id: 'format.italic',
      title: 'Italic',
      run: () => void wrapCommand('textit')(ed().view),
    });
    c.register({
      id: 'format.emph',
      title: 'Emphasis',
      run: () => void wrapCommand('emph')(ed().view),
    });
    c.register({
      id: 'format.texttt',
      title: 'Monospace',
      run: () => void wrapCommand('texttt')(ed().view),
    });
    c.register({
      id: 'compile.pdf',
      title: 'Compile PDF',
      run: () => this.compile(),
      available: () => this.platform.canCompile,
    });
    c.register({
      id: 'compile.stop',
      title: 'Stop Compile',
      run: () => this.shell.cancelCompile(),
      available: () => this.platform.canCompile,
    });
    c.register({
      id: 'sync.sourceToPreview',
      title: 'Show in Preview',
      run: () => {
        this.selectRight('preview');
        this.preview.reveal(ed().path, ed().cursorLine());
      },
    });
    c.register({
      id: 'sync.sourceToPdf',
      title: 'Show in PDF',
      run: () => {
        this.selectRight('pdf');
        if (!this.pdf.reveal(ed().path, ed().cursorLine()))
          notice('No SyncTeX data yet: compile the PDF first.');
      },
    });
    c.register({ id: 'pane.focusEditor', title: 'Focus Editor', run: () => ed().view.focus() });
    c.register({
      id: 'pane.togglePreview',
      title: 'Toggle HTML Preview',
      run: () => {
        const showing = !$('preview').hidden && !$('right-pane').hidden;
        if (showing) $('right-pane').hidden = true;
        else this.selectRight('preview');
      },
    });
    c.register({
      id: 'pane.togglePdf',
      title: 'Toggle PDF',
      run: () => {
        const showing = !$('pdf').hidden && !$('right-pane').hidden;
        if (showing) $('right-pane').hidden = true;
        else this.selectRight('pdf');
      },
    });
    c.register({
      id: 'pane.toggleOutline',
      title: 'Toggle Outline',
      run: () => this.showPane('outline'),
    });
    c.register({
      id: 'pane.toggleProblems',
      title: 'Toggle Problems',
      run: () => this.showPane('problems'),
    });
    c.register({
      id: 'view.toggleToolbars',
      title: 'Show/Hide Toolbars',
      run: () => {
        this.toolbarsHidden = !this.toolbarsHidden;
        this.renderToolbars();
      },
    });
    c.register({ id: 'palette.open', title: 'Command Palette', run: () => this.palette() });
    c.register({
      id: 'palette.sectioning',
      title: 'Sectioning…',
      run: () => this.palette('sectioning'),
    });
    c.register({
      id: 'palette.environments',
      title: 'Environments…',
      run: () => this.palette('environments'),
    });
    c.register({ id: 'palette.size', title: 'Text Size…', run: () => this.palette('size') });
    c.register({
      id: 'palette.alignment',
      title: 'Alignment…',
      run: () => this.palette('alignment'),
    });
    c.register({
      id: 'git.pushReview',
      title: 'Push for Review…',
      run: async () => void (hasRoot() ? await pushReview(this.pushDeps(), this.root) : undefined),
    });
    c.register({
      id: 'git.submit',
      title: 'Submit Version…',
      run: async () =>
        void (hasRoot() ? await submitVersion(this.pushDeps(), this.root) : undefined),
    });
    c.register({
      id: 'git.setToken',
      title: 'Set GitHub Token…',
      run: async () => {
        const t = await promptDialog(
          'GitHub token',
          'Fine-grained personal access token (stored in the Keychain as github-papers-token):',
          '',
          { secret: true, okLabel: 'Save' },
        );
        if (t !== null && t.trim() !== '') {
          await this.shell.setToken(t);
          notice('Token saved to the Keychain.');
        }
      },
    });
    c.register({
      id: 'app.settings',
      title: 'Settings…',
      run: async () => {
        const next = await settingsDialog(this.settings, await this.shell.configLocation());
        if (next === null) return;
        await this.shell.writeConfig('settings.jsonc', serializeSettings(next));
        await this.reloadConfig();
      },
    });
    c.register({
      id: 'app.reloadConfig',
      title: 'Reload Config Files',
      run: () => this.reloadConfig(),
    });
    c.register({
      id: 'edit.selectAllOccurrences',
      title: 'Select All Occurrences',
      run: () => {
        const v = ed().view;
        const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
        if (sel === '') return;
        const text = v.state.doc.toString();
        const ranges = [];
        for (let i = text.indexOf(sel); i !== -1; i = text.indexOf(sel, i + sel.length))
          ranges.push(EditorSelection.range(i, i + sel.length));
        if (ranges.length > 0) v.dispatch({ selection: EditorSelection.create(ranges) });
      },
    });
    for (const [id, fn] of Object.entries(CM_COMMANDS)) {
      if (!c.has(id)) c.register({ id, title: id, run: () => void fn(ed().view) });
    }
  }
}
