# DevTex

A personal LaTeX editor for macOS and iPad/iPhone, built around Obsidian, Zotero and GitHub review. Edit LaTeX on the left and see an instantly updating HTML preview on the right, with click-to-sync in both directions. Compile a real PDF with your TeX Live when you need exact layout, and push a draft to your review repo as one commit. The same `.tex` files open in Obsidian through the companion plugin, with no export step.

Built with Tauri 2 (Rust + TypeScript), CodeMirror 6, unified-latex, MathJax 3 and pdf.js.

## Features

**Editor (macOS and iOS)**
- LaTeX syntax highlighting, bracket matching, `\begin`/`\end` pair highlighting, broken-code highlighting (mismatched environments, unbalanced braces, `\left`/`\right`, `\[ \]`), folding of environments and sections, multiple cursors, find/replace with regex, current-line highlight.
- Auto-`\item`: Enter inside `itemize`/`enumerate`/`description` starts a new item; Enter on an empty item ends the list.
- Completion for commands (including your own `\newcommand`s), environments, `\ref`/`\label` and `\cite` keys, plus grouped palettes for sectioning, environments, text size and alignment.
- Diagnostics for undefined `\ref`s, unknown citekeys and structural errors, plus latexmk warnings on macOS.
- Outline (sections, figures, tables, labels), file tabs, and a Problems panel.

**Instant HTML preview**
- Renders prose, sectioning, lists, emphasis, citations/refs, `tabular`, inline and display math (`equation`, `align`, …), theorem-like environments and floats.
- Uses your macros: `\newcommand`, `\renewcommand`, `\DeclareMathOperator` and argument-free `\def` from the preamble and every included file.
- TikZ, unknown macros and unsupported environments show a labelled placeholder with the source line; they never break the preview.
- Incremental rendering in a Web Worker: only edited blocks are re-parsed and re-typeset. On a 2,725-line, 9-file test project a single-block edit renders well under the 250 ms target (enforced by a test).
- Two-way sync: moving the cursor highlights the matching preview element, and clicking the preview jumps to the source line.

**Multi-file projects**
- Root detection from `% !TEX root = …`, otherwise from the `\input`/`\include` graph; engine from `% !TEX program = …` (pdflatex, xelatex, lualatex).

**PDF (macOS)**
- Compiles with your installed `latexmk` (found on your login shell PATH) using `-synctex=1 -interaction=nonstopmode -file-line-error`. Aux files go to `~/Library/Caches/DevTex/<project>/`; only the final PDF is copied next to the root `.tex`, so nothing extra enters your Obsidian vault.
- pdf.js viewer with SyncTeX forward and inverse search, using a pure TypeScript SyncTeX parser (no `synctex` CLI).
- Clickable compile errors and warnings.

**Obsidian-friendly files**
- Open a folder inside your vault; the `.tex` files on disk are the only copy.
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
  - `settings.jsonc`: editor font, size, highlight colours, preview debounce, timing HUD, latexmk path, bad-box reporting.
  - `keymap.json`: `[{ "key": "Mod-Shift-b", "command": "palette.environments" }]`. Reserved keys are rejected and reported. Map a key to `""` to unbind it.
  - `toolbars.json`: show/hide toolbars holding any command.
  - `syntax/*.json`: custom highlighting rules for LaTeX or embedded code.
- Invalid config never crashes the app: defaults are used and the problems appear in the Problems panel.
- The Settings dialog covers editor font face, font size and highlight colours.
- Optional debug HUD (`preview.timingHud`) shows parse/render/typeset ms per edit.

**iOS / iPadOS**
- Pick your vault folder once. DevTex keeps a security-scoped bookmark and restores access on every launch before touching any file, and all reads and writes go through `NSFileCoordinator`.
- Editing, HTML preview with two-way sync, grouped completion, auto-`\item`, and a keyboard accessory bar for `\ { } $ _ ^ & [ ] % ~`.
- No PDF compile on iOS.

**Companion Obsidian plugin** (`packages/obsidian-devtex`)
- Registers only the `tex` extension, with a CodeMirror 6 editor view (highlighting, environment matching, folding, auto-`\item`, completion). It never touches `.md` handling, and `[[chapter.tex]]` links use Obsidian's own link resolution.

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

Debug builds also read `DEVTEX_OPEN=<folder>` (open a project at launch) and `DEVTEX_RUN=<command,…>` (run commands after opening) for manual QA. Release builds ignore both.

## License

MIT. See [LICENSE](LICENSE). The SyncTeX and log parsers are ported from LaTeX Workshop (MIT).
