# DevTex

[![GitHub release](https://img.shields.io/github/v/release/jsglazer/devtex?logo=github)](https://github.com/jsglazer/devtex/releases) [![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jsglazer/devtex/blob/main/LICENSE) [![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97756?logo=anthropic)](https://claude.ai) [![Gemini Flash Antigravity](https://img.shields.io/badge/Gemini%20Flash-Antigravity-4f86f7?logo=google-gemini&logoColor=white)](https://github.com/google-gemini) [![CI](https://github.com/jsglazer/devtex/actions/workflows/ci.yml/badge.svg)](https://github.com/jsglazer/devtex/actions/workflows/ci.yml) [![CodeQL](https://github.com/jsglazer/devtex/actions/workflows/codeql.yml/badge.svg)](https://github.com/jsglazer/devtex/actions/workflows/codeql.yml) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/jsglazer/devtex/badge)](https://securityscorecards.dev/viewer/?uri=github.com/jsglazer/devtex)

A personal LaTeX editor for macOS and iPad/iPhone, built around Obsidian, Zotero and GitHub review. Edit LaTeX on the left and see an instantly updating HTML preview ("Live") on the right, with click-to-sync in both directions. Compile a real PDF with your TeX Live when you need exact layout, and push a draft to your review repo as one commit. The same `.tex` files open in Obsidian through the companion plugin, with no export step.

Built with Tauri 2 (Rust + TypeScript), CodeMirror 6, unified-latex, MathJax 3 and pdf.js.

## Features

**Editor (macOS and iOS)**
- LaTeX syntax highlighting, bracket matching, `\begin`/`\end` pair highlighting, broken-code highlighting (mismatched environments, unbalanced braces, `\left`/`\right`, `\[ \]`), folding of environments and sections, multiple cursors, find/replace with regex, current-line highlight.
- Auto-`\item`: Enter inside `itemize`/`enumerate`/`description` starts a new item; Enter on an empty item ends the list.
- Completion for commands (including your own `\newcommand`s), environments, `\ref`/`\label` and `\cite` keys, plus grouped palettes for sectioning, environments, text size and alignment.
- Diagnostics for undefined `\ref`s, unknown citekeys and structural errors, plus latexmk warnings on macOS.
- Outline (sections, Beamer frames, figures, tables, labels) that updates as you type, file tabs, and a Problems panel. Outline titles show the text branch of `\texorpdfstring{…}{…}`. Frames are listed under their section, titled from `{…}`, `\frametitle` or `\titlepage`.
- Renaming either end of an environment renames the other: change `\begin{enumerate}` to `\begin{itemize}` and the `\end` follows (and the other way round), in one undo step.
- Move Line Up/Down (Edit menu, default ⌃⌥↑/⌃⌥↓, remappable in `keymap.json`) moves the current line or selected lines.
- Word wrap on/off: View ▸ Toggle Word Wrap (⌥⌘W), saved to `settings.jsonc`.
- Show/Hide Preamble (toolbar **Preamble**, View ▸ Show/Hide Preamble, ⌥⌘P) folds everything before `\begin{document}` into one line. The preamble is hidden by default when a file opens (`editor.hidePreamble`), and the **Preamble** button is highlighted while it is hidden.
- Tabs show only the files you opened, each with a close button (×, File ▸ Close File, ⇧⌘W). Opening a folder shows its main document; File ▸ Go to File… (⌘P) opens any other `.tex`/`.bib` file of the project; File ▸ Open File… (⌥⌘O, macOS) opens one or more files from disk, each in its own project. Every project file is still loaded, so the preview, labels and citations see the whole project.

**Instant HTML preview (Live)**
- Renders prose, sectioning (math in headings too, including `\texorpdfstring` and `\boldmath`), lists, emphasis, citations/refs, `tabular`, inline and display math (`equation`, `align`, …), theorem-like environments and floats.
- Uses your macros: `\newcommand`, `\renewcommand`, `\DeclareMathOperator` and argument-free `\def` from the preamble and every included file.
- Beamer: frames render as slides with their title and subtitle (`\begin{frame}{…}{…}`, `\frametitle`, `\framesubtitle`, `\frame{…}`), plus `block`/`alertblock`/`exampleblock`, `columns`/`column` (and `\column{0.5\textwidth}`), `\alert`, and a real title page (`\titlepage` / `\maketitle` built from `\title`, `\subtitle`, `\author`, `\institute` and `\date`). Overlay specs (`\item<2->`, `\only<…>`, `\pause`, …) are ignored, so every overlay's content shows at once.
- TikZ, unknown macros and unsupported environments show a labelled placeholder with the source line; they never break the preview.
- Incremental rendering in a Web Worker: only edited blocks are re-parsed and re-typeset. On a 2,725-line, 9-file test project a single-block edit renders well under the 250 ms target (enforced by a test).
- Two-way sync: moving the cursor highlights the matching element in whichever view is showing (Live or PDF), and clicking either view jumps to the source line.
- **Scroll Lock** (button on the Preview/PDF bar, or View ▸ Toggle Scroll Lock): the Live preview or PDF scrolls along with the editor, and scrolling the Live preview or PDF scrolls the editor.
- **− / % / +** on the right of the Preview/PDF bar zoom whichever view is showing (Live text size or PDF; **Fit** fits the PDF to the pane width).
- Drag the divider between the editor and the preview to resize the panes; double-click it to reset to 50/50. The split is remembered.

**Multi-file projects**
- Root detection from `% !TEX root = …`, otherwise from the `\input`/`\include` graph; engine from `% !TEX program = …` (pdflatex, xelatex, lualatex).

**PDF (macOS)**
- Compiles with your installed `latexmk` (found on your login shell PATH) using `-synctex=1 -interaction=nonstopmode -file-line-error`. Aux files go to `~/Library/Caches/DevTex/<project>/`; only the final PDF is copied next to the root `.tex`, so nothing extra enters your Obsidian vault.
- pdf.js viewer with SyncTeX forward and inverse search, using a pure TypeScript SyncTeX parser (no `synctex` CLI). The highlight is clipped to the page. In Beamer, SyncTeX records a whole frame against its `\end{frame}` line, so forward search outlines the whole slide. A PDF already on disk when you open the project uses the SyncTeX data from its last DevTex compile, so sync works without recompiling.
- If the PDF is deleted on disk, the PDF pane clears and prompts you to compile.
- Clickable compile errors and warnings.
- latexmk runs with `-norc`, so a `latexmkrc`/`.latexmkrc` inside a project folder (which latexmk would execute as Perl) is never run. Your own `~/.latexmkrc` and `~/.config/latexmk/latexmkrc` are still read (passed with `-r`).
- Links in the Live preview are inert, MathJax's `html` extension (`\href`, `\style`, …) is off, and the app window refuses to navigate anywhere but the app itself.

**Obsidian-friendly files**
- Open a folder inside your vault; the `.tex` files on disk are the only copy.
- File ▸ Open Recent Project… (⇧⌘O, macOS) lists the last 15 project folders.
- External changes (Obsidian, Obsidian Sync) are detected by file watching on macOS, and on iOS on foreground, every 5 s and before each save. A clean buffer reloads silently; with unsaved edits you get a prompt (keep mine / load disk / show diff). Every save checks the file's mtime and SHA-256 first and never overwrites an external edit without asking.

**Citations**
- macOS: Better BibTeX JSON-RPC lookup from a running Zotero (300 ms timeout, cached, never blocks typing).
- Everywhere: your project's `.bib` files (the only source on iOS, and the fallback when Zotero is closed).

**GitHub review push** (same conventions as markup-reviewer)
- Pushes the root `.tex`, every `\input`/`\include` file and the PDF (if built) to `jsglazer/papers` on `main` as one commit, through the GitHub Git Data API (no local git).
- Repo folder from `% !DevTex git = <folder>/`; you're prompted for it the first time.
- Editable message `Review: <root file> <YYYYMMDD-HHMMSS>` with Approve/Cancel. After a successful push, `% !DevTex pushed = <stamp>` is written to the root file.
- Refuses and warns if a remote file changed since your last push.
- **Submit Version** uses `Submitted version {submitstamp}` from `% !DevTex submitstamp = …`. It aborts if that comment is missing, and its Proceed/Abort dialog defaults to Abort.
- The token is a fine-grained PAT stored in the Keychain as `github-papers-token`.

**Shortcuts and configuration**
- The macOS menu is defined explicitly in Rust, so system shortcuts (⌘Q/W/C/V/X/Z/⇧Z/A/H/M, ⌘Tab, ⌘Space, …) are never taken by app commands.
- Config files (JSONC) live in `~/Library/Application Support/DevTex/` on macOS and in the app container on iOS:
  - `settings.jsonc`: word wrap, hidden preamble, preview debounce, timing HUD, latexmk path, bad-box reporting, interface zoom and the style choice (`ui.followSharedStyle`, `ui.theme`, `ui.themeDark`).
  - `keymap.json`: `[{ "key": "Mod-Shift-b", "command": "palette.environments" }]`. Reserved keys are rejected and reported. Map a key to `""` to unbind it.
  - `toolbars.json`: show/hide toolbars holding any command. Use `"|"` (or `"-"`, or `{ "separator": true }`) as an item for a divider.
  - `recent.json`: the recent projects list, written by the app.
  - `syntax/*.json`: custom highlighting rules for LaTeX or embedded code. A rule may leave out `color` and `fontStyle`; it then only gets the class `.cm-dt-syn-<name>-<token>`, which a style profile can style.
  - `themes/user.css`: your CSS on top of any style profile, in DevTex only (see **Style profiles** below).
- Invalid config never crashes the app: defaults are used and the problems appear in the Problems panel.
- The Settings dialog has the **Follow shared style** switch and picks the light and dark style profiles. It has quick controls for the editor font, font size and highlight colours. It shows the config folder's path (selectable) with an **Open Config Folder** button (macOS).
- Optional debug HUD (`preview.timingHud`) shows parse/render/typeset ms per edit.

**iOS / iPadOS**
- Pick your vault folder once. DevTex keeps a security-scoped bookmark and restores access on every launch before touching any file, and all reads and writes go through `NSFileCoordinator`.
- Editing, HTML preview with two-way sync, grouped completion, auto-`\item`, and a keyboard accessory bar for `\ { } $ _ ^ & [ ] % ~`.
- No PDF compile on iOS.

**Companion Obsidian plugin** (`packages/obsidian-devtex`)
- Registers only the `tex` extension, with a CodeMirror 6 editor view (highlighting, environment matching, folding, auto-`\item`, completion). It never touches `.md` handling, and `[[chapter.tex]]` links use Obsidian's own link resolution.

## Style profiles

DevTex's colours and fonts come from [DevStyle](https://github.com/jsglazer/devstyle), the shared style system for my apps. This covers the window, editor, syntax colours, Live preview and the area around the PDF. A DevStyle **profile** is a plain `.css` file that sets `--ds-*` tokens. Profiles come in light/dark pairs, and every DevStyle app reads them from one shared folder, so a style picked in any app applies to all of them.

- **Shared folder (macOS):** `~/Library/Group Containers/PWGXN26URQ.com.jsglazer.devstyle/DevStyle/`. It holds `devstyle.json`, which names the light and dark profile every app follows, and `profiles/<id>.css`. On first launch DevTex copies DevStyle's built-in profiles there: Default, Paper, High Contrast and Solarized, each Light and Dark. It never overwrites a file that is already there, so you can edit them. The folder's path is shown in Settings.
- **Follow shared style / Use my own:** with `ui.followSharedStyle` on (the default), DevTex shows the pair named in `devstyle.json`. Picking a profile in Settings, View ▸ Style Profile or **Select Style Profile…** then changes the style for every app that follows it, and the dialog says so. Turn the switch off to give DevTex its own pair (`ui.theme` / `ui.themeDark`, DevStyle profile ids such as `paper-light`) without touching other apps.
- **Light and dark:** DevTex switches between the two profiles live when macOS changes appearance. Changes to `devstyle.json` or to the active profile, made by another app or by hand, apply within a moment. File ▸ Reload Config Files reloads them as well.
- **Window appearance:** the profile's header (`appearance=light|dark`) sets the native window appearance (title bar, scroll bars, form controls), for example when a dark profile is used in light mode.
- **Problems:** a missing or broken profile, or a bad `devstyle.json`, falls back to Default and is reported in Problems.
- **iOS:** there is no shared folder, so DevTex uses DevStyle's built-in profiles with its own `ui.theme` / `ui.themeDark`, and the follow switch is hidden.
- **`themes/user.css`** (in DevTex's config folder, optional) overrides any profile, in DevTex only. Set any `--dt-*` variable there, or add your own rules. The Settings dialog's font, size and highlight-colour controls write their values into a block that DevTex manages inside `user.css`, so profiles are never rewritten by the app. Anything outside that block is yours. Saving `user.css` reloads it automatically on macOS.
- **Stacking order:** cascade layers, `@layer cm, app-base, ds-profile, app-override, user`. CodeMirror's own theme is lowest. DevTex's layout-only stylesheet and its `--dt-*` → `--ds-*` aliases come next, then the DevStyle profile, then `user.css`. A profile rule always wins over the built-in look, whatever its specificity.
- **PDF pages** are drawn as images and can't follow a profile: only their surroundings do (`--ds-page-bg`, `--ds-page-shadow`). `--ds-page-filter` (`none` by default) lets a dark profile dim the pages, e.g. `brightness(0.85)`.
- **Upgrading from 1.0.5 or 1.0.6:** DevTex's own `themes/*.css` profiles move to DevStyle the first time 1.0.7 runs.
  - Untouched copies of the shipped profiles are deleted, and DevStyle's built-in with the same name takes over. `Default Light` becomes `default-light`, and so on.
  - A profile you edited or made yourself becomes a DevStyle profile in the shared folder, named `<name>-devtex` (e.g. `paper-dark-devtex`, shown as "Paper Dark (DevTex)"). Its `--dt-*` values are renamed to their `--ds-*` tokens, and anything it doesn't set is filled in from the matching built-in. DevTex keeps showing it ("Use my own"), and other apps are left unchanged. The old file is then removed from `themes/`.
  - Problems lists what moved.
- **Upgrading from 1.0.4 or earlier:** the old `colors` and `editor.fontFamily`/`fontSize`/`lineHeight` keys are removed from `settings.jsonc`. Values you had changed from their defaults go into `themes/user.css`.

**Making a profile:** add `profiles/<id>.css` to the shared folder. It needs the DevStyle header and sets any `--ds-*` tokens; the [devstyle README](https://github.com/jsglazer/devstyle) lists every token. Then pick it in Settings. Tokens it leaves out keep the built-in Default's value, and DevTex lists them in Problems as missing.

```css
/* devstyle: name="Ocean Dark" appearance=dark pair=default-light */
:root {
  color-scheme: dark;
  --ds-bg: #0f1d2b;
  --ds-panel: #142536;
  --ds-fg: #d8e6f3;
  --ds-accent: #4fb3ff;
  --ds-editor-bg: #0c1824;
  --ds-active-line: rgba(79, 179, 255, 0.1);
  --ds-syn-keyword: #7fd1ff;
  --ds-prose-font: 'Iowan Old Style', Georgia, serif;
}
/* other CSS works in DevTex's web views (other apps may ignore it) */
.cm-line { letter-spacing: 0.2px; }
```

**Variable reference.** These `--dt-*` names are the stable contract inside DevTex and keep working across versions; other selectors may change. Each one takes its value from the DevStyle token shown. Set the `--ds-*` token in a profile to change every app, or the `--dt-*` variable in `user.css` to change DevTex only. Where two variables share a token (e.g. `--dt-preview-bg` and `--dt-bg`), set the `--dt-*` one in `user.css` to tell them apart.

| Variable | Group | DevStyle token | Used for |
|---|---|---|---|
| `--dt-bg` | App | `--ds-bg` | Window and editor-tab background |
| `--dt-fg` | App | `--ds-fg` | Main text colour |
| `--dt-muted` | App | `--ds-muted` | Secondary text (status bar, labels) |
| `--dt-border` | App | `--ds-border` | Dividers and control borders |
| `--dt-panel` | App | `--ds-panel` | Toolbars, tab bars, Outline, Problems and status bar |
| `--dt-accent` | App | `--ds-accent` | Accent colour (primary buttons, links, Beamer titles) |
| `--dt-accent-fg` | App | `--ds-fg-on-accent` | Text drawn on the accent colour |
| `--dt-error` | App | `--ds-error` | Errors, broken math, deleted diff lines, Beamer alerts |
| `--dt-warning` | App | `--ds-warning` | Warnings |
| `--dt-success` | App | `--ds-success` | Added diff lines, Beamer example blocks |
| `--dt-sync` | App | `--ds-sync` | Sync highlight (Preview block, PDF box, editor flash) |
| `--dt-shadow` | App | `--ds-overlay` | Shadow and backdrop colour for dialogs and slides |
| `--dt-dialog-shadow` | App | `--ds-shadow` | Dialog shadow (a box-shadow value) |
| `--dt-font` | App | `--ds-ui-font` | Interface font family |
| `--dt-font-size` | App | `--ds-ui-size` | Interface font size |
| `--dt-mono-font` | App | `--ds-mono-font` | Monospace font for file locations and code |
| `--dt-editor-font` | Editor | `--ds-mono-font` | Editor font family |
| `--dt-editor-size` | Editor | `--ds-mono-size` | Editor font size |
| `--dt-editor-line-height` | Editor | `--ds-mono-line-height` | Editor line height |
| `--dt-editor-bg` | Editor | `--ds-editor-bg` | Editor background |
| `--dt-editor-fg` | Editor | `--ds-editor-fg` | Editor text |
| `--dt-editor-gutter` | Editor | `--ds-gutter-bg` | Line-number gutter background |
| `--dt-editor-gutter-fg` | Editor | `--ds-gutter-fg` | Line numbers |
| `--dt-editor-cursor` | Editor | `--ds-cursor` | Cursor colour |
| `--dt-editor-selection` | Editor | `--ds-selection` | Selection background |
| `--dt-editor-active-line` | Editor | `--ds-active-line` | Current-line highlight |
| `--dt-editor-matching-bracket` | Editor | `--ds-matching-bracket` | Matching-bracket highlight |
| `--dt-editor-selection-match` | Editor | `--ds-selection-match` | Other occurrences of the selection |
| `--dt-editor-search-match` | Editor | `--ds-search-match` | Search matches |
| `--dt-editor-broken` | Editor | `--ds-broken` | Unbalanced \begin/\end and braces |
| `--dt-editor-env-pair` | Editor | `--ds-pair-highlight` | The \begin/\end pair around the cursor |
| `--dt-syntax-command` | Syntax | `--ds-syn-keyword` | LaTeX commands |
| `--dt-syntax-env` | Syntax | `--ds-syn-env` | Environment names |
| `--dt-syntax-atom` | Syntax | `--ds-syn-atom` | Atoms (e.g. & and special characters) |
| `--dt-syntax-comment` | Syntax | `--ds-syn-comment` | Comments |
| `--dt-syntax-math` | Syntax | `--ds-syn-math` | Math |
| `--dt-syntax-number` | Syntax | `--ds-syn-number` | Numbers and lengths |
| `--dt-syntax-bracket` | Syntax | `--ds-syn-bracket` | Brackets and braces |
| `--dt-syntax-meta` | Syntax | `--ds-syn-meta` | Meta tokens |
| `--dt-syntax-error` | Syntax | `--ds-syn-error` | Invalid tokens |
| `--dt-preview-font` | Preview | `--ds-prose-font` | Preview body font family |
| `--dt-preview-size` | Preview | `--ds-prose-size` | Preview body font size |
| `--dt-preview-line-height` | Preview | `--ds-prose-line-height` | Preview line height |
| `--dt-preview-heading-font` | Preview | `--ds-heading-font` | Preview heading font family |
| `--dt-preview-fg` | Preview | `--ds-fg` | Preview text |
| `--dt-preview-bg` | Preview | `--ds-bg` | Preview background |
| `--dt-preview-link` | Preview | `--ds-link` | Links, citations and references in the Preview |
| `--dt-preview-math` | Preview | none (DevTex only, default `currentColor`) | Typeset math colour |
| `--dt-pdf-bg` | PDF | `--ds-page-bg` | Area around the PDF pages |
| `--dt-pdf-shadow` | PDF | `--ds-page-shadow` | Page shadow (a box-shadow value) |
| `--dt-pdf-filter` | PDF | `--ds-page-filter` | CSS filter for the pages (a dark profile can dim them) |

## Repository layout

```
packages/core            Pure TypeScript: parsing, incremental HTML render, source maps, multi-file graph,
                         latexmk log + SyncTeX parsing, matching, auto-\item, completion, diagnostics,
                         BibTeX, Better BibTeX client, config/keymap loading, push planning.
                         No @tauri-apps, obsidian, DOM or I/O imports.
packages/cm-latex        CodeMirror 6 extensions shared by the app and the Obsidian plugin.
packages/obsidian-devtex Companion Obsidian plugin.
apps/devtex              Tauri frontend (editor, preview worker, pdf.js, dialogs).
apps/devtex/src-tauri    Rust core: guarded file I/O, project scope, file watching, latexmk, GitHub Git Data API,
                         Better BibTeX transport, Keychain, config store, macOS menu.
plugins/tauri-plugin-ios-bookmarks  Swift/Rust Tauri plugin: vault bookmark + NSFileCoordinator I/O.
```

## Building

Requirements: macOS 14+, Xcode, Node 22+, pnpm 12, Rust (pinned in `rust-toolchain.toml`), cargo-audit (`cargo install cargo-audit --locked`, for `lint:rust`), TeX Live (for PDF compile), CocoaPods (for iOS).

```sh
pnpm install
pnpm -r test                 # TypeScript tests (Vitest)
cargo test --workspace       # Rust tests
(cd plugins/tauri-plugin-ios-bookmarks/ios/BookmarkCore && swift test)   # Swift tests
pnpm lint && pnpm lint:rust  # ESLint + Prettier, rustfmt + clippy -D warnings + cargo audit

cd apps/devtex
pnpm tauri dev               # run the macOS app
pnpm tauri build             # DevTex.app + DMG
pnpm tauri ios build         # iOS (needs signing; add --no-sign for an unsigned build)

cd packages/obsidian-devtex
pnpm build                   # dist/main.js; copy it with manifest.json to <vault>/.obsidian/plugins/devtex/
```

Debug builds also read `DEVTEX_OPEN=<folder>` (open a project at launch) and `DEVTEX_RUN=<command,…>` (run commands after opening) for manual QA. `DEVTEX_RUN` also accepts `goto:<line>` to move the cursor. Release builds ignore both.

## License

MIT. See [LICENSE](LICENSE). The SyncTeX and log parsers are ported from LaTeX Workshop (MIT).
