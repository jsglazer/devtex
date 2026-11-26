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
  - `settings.jsonc`: word wrap, hidden preamble, preview debounce, timing HUD, latexmk path, bad-box reporting, interface zoom and the style profiles (`ui.theme`, `ui.themeDark`).
  - `keymap.json`: `[{ "key": "Mod-Shift-b", "command": "palette.environments" }]`. Reserved keys are rejected and reported. Map a key to `""` to unbind it.
  - `toolbars.json`: show/hide toolbars holding any command. Use `"|"` (or `"-"`, or `{ "separator": true }`) as an item for a divider.
  - `recent.json`: the recent projects list, written by the app.
  - `syntax/*.json`: custom highlighting rules for LaTeX or embedded code. A rule may leave out `color` and `fontStyle`; it then only gets the class `.cm-dt-syn-<name>-<token>`, which a style profile can style.
  - `themes/*.css`: style profiles and `user.css` (see **Style profiles** below).
- Invalid config never crashes the app: defaults are used and the problems appear in the Problems panel.
- The Settings dialog picks the light and dark style profiles and has quick controls for the editor font, font size and highlight colours. It shows the config folder's path (selectable) with an **Open Config Folder** button (macOS).
- Optional debug HUD (`preview.timingHud`) shows parse/render/typeset ms per edit.

**iOS / iPadOS**
- Pick your vault folder once. DevTex keeps a security-scoped bookmark and restores access on every launch before touching any file, and all reads and writes go through `NSFileCoordinator`.
- Editing, HTML preview with two-way sync, grouped completion, auto-`\item`, and a keyboard accessory bar for `\ { } $ _ ^ & [ ] % ~`.
- No PDF compile on iOS.

**Companion Obsidian plugin** (`packages/obsidian-devtex`)
- Registers only the `tex` extension, with a CodeMirror 6 editor view (highlighting, environment matching, folding, auto-`\item`, completion). It never touches `.md` handling, and `[[chapter.tex]]` links use Obsidian's own link resolution.

## Style profiles

All of DevTex's colours and fonts (the window, editor, syntax colours, Live preview and the area around the PDF) come from a **style profile**: a plain `.css` file in the `themes/` folder of the config folder, next to `syntax/`.

- Profiles come in light/dark pairs that follow the system appearance: `ui.theme` names the light profile and `ui.themeDark` the dark one. DevTex switches between them live when macOS changes appearance.
- Built in: **Default**, **Paper**, **High Contrast** and **Solarized**, each as a Light and a Dark file (`Default Light.css`, `Default Dark.css`, …). The first time one is used it is copied into `themes/` so you can edit it. DevTex never overwrites a file that is already in `themes/`; delete it to get the built-in version back.
- Choose with Settings (Light profile / Dark profile), View ▸ Style Profile (sets both of a pair), or the **Select Style Profile…** command. All three switch live, without reloading or resetting the editor.
- Saving a profile or `user.css` reloads it automatically on macOS. File ▸ Reload Config Files reloads them on every platform, including iOS.
- `themes/user.css` (optional) overrides every profile. The Settings dialog's font, size and highlight-colour controls write their values into a block that DevTex manages inside `user.css`, so the profile files are never rewritten by the app. Anything outside that block is yours.
- Stacking order uses cascade layers, `@layer cm, base, profile, user`: CodeMirror's own theme is lowest, then DevTex's layout-only base stylesheet, then the profile, then `user.css`. A profile rule always wins over the built-in look, whatever its specificity.
- A header comment `/* devtex: appearance=light */` or `/* devtex: appearance=dark */` sets the native window appearance (title bar, scroll bars, form controls) to match the profile, for example a dark profile used in light mode.
- If a profile is missing or can't be read, DevTex uses Default and reports it in Problems.
- PDF pages are drawn as images and can't follow a profile: only their surroundings do (`--dt-pdf-bg`, `--dt-pdf-shadow`). `--dt-pdf-filter` (empty by default) lets a dark profile dim the pages, e.g. `brightness(0.85)`.
- Upgrading from 1.0.4 or earlier: the old `colors` and `editor.fontFamily`/`fontSize`/`lineHeight` values in `settings.jsonc` are written into `themes/Default Light.css` and `Default Dark.css` the first time 1.0.5 runs, then removed from `settings.jsonc`. Problems lists them as moved.

**Minimal example profile** (`themes/Ocean Dark.css`, then pick it as the dark profile):

```css
/* devtex: appearance=dark */
:root {
  --dt-bg: #0f1d2b;
  --dt-panel: #142536;
  --dt-fg: #d8e6f3;
  --dt-accent: #4fb3ff;
  --dt-editor-bg: #0c1824;
  --dt-editor-active-line: rgba(79, 179, 255, 0.1);
  --dt-syntax-command: #7fd1ff;
  --dt-preview-font: 'Iowan Old Style', Georgia, serif;
}
/* any other CSS works too */
.cm-line { letter-spacing: 0.2px; }
```

A profile only needs the variables it changes: the built-in Default Light (or Default Dark, for the dark slot) always sits underneath it, so every other variable keeps its Default value.

**Variable reference** (the stable contract: these names keep working across versions; other selectors may change):

| Variable | Group | What it styles |
|---|---|---|
| `--dt-bg` | App | Window and editor-tab background |
| `--dt-fg` | App | Main text colour |
| `--dt-muted` | App | Secondary text (status bar, labels, gutter numbers) |
| `--dt-border` | App | Dividers and control borders |
| `--dt-panel` | App | Toolbars, tab bars, Outline, Problems and status bar |
| `--dt-accent` | App | Accent colour (primary buttons, links, Beamer titles) |
| `--dt-accent-fg` | App | Text drawn on the accent colour |
| `--dt-error` | App | Errors, broken math, deleted diff lines, Beamer alerts |
| `--dt-warning` | App | Warnings |
| `--dt-success` | App | Added diff lines, Beamer example blocks |
| `--dt-sync` | App | Sync highlight (Preview block, PDF box, editor flash) |
| `--dt-shadow` | App | Shadow colour for dialogs, slides and PDF pages |
| `--dt-font` | App | Interface font family |
| `--dt-font-size` | App | Interface font size |
| `--dt-mono-font` | App | Monospace font for file locations and code |
| `--dt-editor-font` | Editor | Editor font family |
| `--dt-editor-size` | Editor | Editor font size |
| `--dt-editor-line-height` | Editor | Editor line height |
| `--dt-editor-bg` | Editor | Editor background |
| `--dt-editor-fg` | Editor | Editor text |
| `--dt-editor-gutter` | Editor | Line-number gutter background |
| `--dt-editor-cursor` | Editor | Cursor colour |
| `--dt-editor-selection` | Editor | Selection background |
| `--dt-editor-active-line` | Editor | Current-line highlight |
| `--dt-editor-matching-bracket` | Editor | Matching-bracket highlight |
| `--dt-editor-selection-match` | Editor | Other occurrences of the selection |
| `--dt-editor-broken` | Editor | Unbalanced \begin/\end and braces |
| `--dt-editor-env-pair` | Editor | The \begin/\end pair around the cursor |
| `--dt-syntax-command` | Syntax | LaTeX commands |
| `--dt-syntax-env` | Syntax | Environment names |
| `--dt-syntax-atom` | Syntax | Atoms (e.g. & and special characters) |
| `--dt-syntax-comment` | Syntax | Comments |
| `--dt-syntax-math` | Syntax | Math |
| `--dt-syntax-number` | Syntax | Numbers and lengths |
| `--dt-syntax-bracket` | Syntax | Brackets and braces |
| `--dt-syntax-meta` | Syntax | Meta tokens |
| `--dt-syntax-error` | Syntax | Invalid tokens |
| `--dt-preview-font` | Preview | Preview body font family |
| `--dt-preview-size` | Preview | Preview body font size |
| `--dt-preview-line-height` | Preview | Preview line height |
| `--dt-preview-heading-font` | Preview | Preview heading font family |
| `--dt-preview-fg` | Preview | Preview text |
| `--dt-preview-bg` | Preview | Preview background |
| `--dt-preview-link` | Preview | Links, citations and references in the Preview |
| `--dt-preview-math` | Preview | Typeset math colour |
| `--dt-pdf-bg` | PDF | Area around the PDF pages |
| `--dt-pdf-shadow` | PDF | Page shadow (a box-shadow value) |
| `--dt-pdf-filter` | PDF | CSS filter for the pages, empty by default (e.g. a dark profile can dim them) |

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

Requirements: macOS 14+, Xcode, Node 22+, pnpm 12, Rust (pinned in `rust-toolchain.toml`), TeX Live (for PDF compile), CocoaPods (for iOS).

```sh
pnpm install
pnpm -r test                 # TypeScript tests (Vitest)
cargo test --workspace       # Rust tests
(cd plugins/tauri-plugin-ios-bookmarks/ios/BookmarkCore && swift test)   # Swift tests
pnpm lint && pnpm lint:rust  # ESLint + Prettier, rustfmt + clippy -D warnings

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
