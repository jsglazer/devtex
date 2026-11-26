//! Explicit macOS application menu (tauri::menu). NSMenu sees accelerators
//! before the webview, so every editor shortcut that is also a menu item is
//! defined here and forwarded to the frontend as a command id
//! (`devtex://menu`); system shortcuts (Cmd+Q/W/C/V/X/Z/A/H/M) are only ever
//! attached to the predefined system items, never to app commands.
//!
//! The menu is described by a pure [`menu_spec`] so its accelerators are
//! unit-tested for collisions and reserved keys.

use std::collections::BTreeSet;

pub const MENU_EVENT: &str = "devtex://menu";

#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    /// App command forwarded to the frontend.
    Command {
        id: &'static str,
        label: &'static str,
        accel: Option<&'static str>,
    },
    /// Predefined system item (undo, copy, quit …) with its standard shortcut.
    System(SystemItem),
    Separator,
    /// Nested submenu (e.g. View ▸ Style Profile).
    Nested(Submenu),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SystemItem {
    About,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
    CloseWindow,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    Zoom,
    Fullscreen,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Submenu {
    pub title: &'static str,
    pub items: Vec<Item>,
}

/// Accelerators owned by the system items; app commands must never use them.
pub const SYSTEM_ACCELERATORS: [&str; 12] = [
    "CmdOrCtrl+Q",
    "CmdOrCtrl+W",
    "CmdOrCtrl+C",
    "CmdOrCtrl+V",
    "CmdOrCtrl+X",
    "CmdOrCtrl+Z",
    "CmdOrCtrl+Shift+Z",
    "CmdOrCtrl+A",
    "CmdOrCtrl+H",
    "CmdOrCtrl+M",
    "CmdOrCtrl+Tab",
    "CmdOrCtrl+Space",
];

fn cmd(id: &'static str, label: &'static str, accel: Option<&'static str>) -> Item {
    Item::Command { id, label, accel }
}

pub fn menu_spec() -> Vec<Submenu> {
    use SystemItem::*;
    vec![
        Submenu {
            title: "DevTex",
            items: vec![
                Item::System(About),
                Item::Separator,
                cmd("app.settings", "Settings…", Some("CmdOrCtrl+,")),
                Item::Separator,
                Item::System(Hide),
                Item::System(HideOthers),
                Item::System(ShowAll),
                Item::Separator,
                Item::System(Quit),
            ],
        },
        Submenu {
            title: "File",
            items: vec![
                cmd(
                    "file.openProject",
                    "Open Project Folder…",
                    Some("CmdOrCtrl+O"),
                ),
                cmd(
                    "file.openRecent",
                    "Open Recent Project…",
                    Some("CmdOrCtrl+Shift+O"),
                ),
                cmd("file.openFile", "Open File…", Some("CmdOrCtrl+Alt+O")),
                cmd("file.quickOpen", "Go to File…", Some("CmdOrCtrl+P")),
                cmd("file.save", "Save", Some("CmdOrCtrl+S")),
                Item::Separator,
                cmd("file.closeFile", "Close File", Some("CmdOrCtrl+Shift+W")),
                Item::System(CloseWindow),
            ],
        },
        Submenu {
            title: "Edit",
            items: vec![
                Item::System(Undo),
                Item::System(Redo),
                Item::Separator,
                Item::System(Cut),
                Item::System(Copy),
                Item::System(Paste),
                Item::System(SelectAll),
                Item::Separator,
                cmd("search.find", "Find…", Some("CmdOrCtrl+F")),
                cmd(
                    "search.replace",
                    "Find and Replace…",
                    Some("CmdOrCtrl+Alt+F"),
                ),
                cmd("search.next", "Find Next", Some("CmdOrCtrl+G")),
                cmd(
                    "search.previous",
                    "Find Previous",
                    Some("CmdOrCtrl+Shift+G"),
                ),
                Item::Separator,
                cmd("edit.toggleComment", "Toggle Comment", Some("CmdOrCtrl+/")),
                cmd(
                    "edit.selectNextOccurrence",
                    "Select Next Occurrence",
                    Some("CmdOrCtrl+D"),
                ),
                Item::Separator,
                // no accelerator: the shortcut (default Ctrl+Opt+↑/↓) lives in
                // keymap.json so the user can remap it
                cmd("edit.moveLineUp", "Move Line Up", None),
                cmd("edit.moveLineDown", "Move Line Down", None),
            ],
        },
        Submenu {
            title: "Format",
            items: vec![
                cmd("format.bold", "Bold", Some("CmdOrCtrl+B")),
                cmd("format.italic", "Italic", Some("CmdOrCtrl+I")),
                cmd("format.emph", "Emphasis", Some("CmdOrCtrl+Shift+E")),
                cmd("format.texttt", "Monospace", Some("CmdOrCtrl+Shift+T")),
                Item::Separator,
                cmd(
                    "palette.sectioning",
                    "Sectioning…",
                    Some("CmdOrCtrl+Shift+S"),
                ),
                cmd(
                    "palette.environments",
                    "Environments…",
                    Some("CmdOrCtrl+Shift+B"),
                ),
                cmd("palette.size", "Text Size…", Some("CmdOrCtrl+Shift+K")),
                cmd("palette.alignment", "Alignment…", Some("CmdOrCtrl+Shift+L")),
                cmd(
                    "palette.open",
                    "Command Palette…",
                    Some("CmdOrCtrl+Shift+P"),
                ),
            ],
        },
        Submenu {
            title: "LaTeX",
            items: vec![
                cmd("compile.pdf", "Compile PDF", Some("CmdOrCtrl+R")),
                cmd("compile.stop", "Stop Compile", Some("CmdOrCtrl+Shift+R")),
                Item::Separator,
                cmd(
                    "sync.sourceToPreview",
                    "Show in Preview",
                    Some("CmdOrCtrl+J"),
                ),
                cmd("sync.sourceToPdf", "Show in PDF", Some("CmdOrCtrl+Shift+J")),
                Item::Separator,
                cmd(
                    "git.pushReview",
                    "Push for Review…",
                    Some("CmdOrCtrl+Shift+U"),
                ),
                cmd("git.submit", "Submit Version…", Some("CmdOrCtrl+Alt+U")),
                cmd("git.setToken", "Set GitHub Token…", None),
            ],
        },
        Submenu {
            title: "View",
            items: vec![
                cmd("pane.focusEditor", "Focus Editor", Some("CmdOrCtrl+1")),
                cmd(
                    "pane.togglePreview",
                    "Toggle Live Preview",
                    Some("CmdOrCtrl+2"),
                ),
                cmd("pane.togglePdf", "Toggle PDF", Some("CmdOrCtrl+3")),
                cmd("pane.toggleOutline", "Toggle Outline", Some("CmdOrCtrl+4")),
                cmd(
                    "pane.toggleProblems",
                    "Toggle Problems",
                    Some("CmdOrCtrl+5"),
                ),
                cmd(
                    "view.toggleToolbars",
                    "Show/Hide Toolbars",
                    Some("CmdOrCtrl+Alt+T"),
                ),
                cmd(
                    "view.togglePreamble",
                    "Show/Hide Preamble",
                    Some("CmdOrCtrl+Alt+P"),
                ),
                cmd(
                    "view.toggleWordWrap",
                    "Toggle Word Wrap",
                    Some("CmdOrCtrl+Alt+W"),
                ),
                cmd("view.toggleScrollLock", "Toggle Scroll Lock", None),
                Item::Separator,
                Item::Nested(Submenu {
                    title: "Style Profile",
                    items: vec![
                        cmd("view.styleProfile.Default", "Default", None),
                        cmd("view.styleProfile.Paper", "Paper", None),
                        cmd("view.styleProfile.HighContrast", "High Contrast", None),
                        cmd("view.styleProfile.Solarized", "Solarized", None),
                        Item::Separator,
                        cmd("view.selectStyleProfile", "Select Style Profile…", None),
                    ],
                }),
                Item::Separator,
                cmd("view.zoomIn", "Zoom In", Some("CmdOrCtrl+=")),
                cmd("view.zoomOut", "Zoom Out", Some("CmdOrCtrl+-")),
                cmd("view.zoomReset", "Actual Size", Some("CmdOrCtrl+0")),
                Item::Separator,
                cmd("pdf.zoomIn", "Zoom PDF In", None),
                cmd("pdf.zoomOut", "Zoom PDF Out", None),
                cmd("pdf.zoomFit", "Fit PDF to Width", None),
                Item::Separator,
                Item::System(Fullscreen),
            ],
        },
        Submenu {
            title: "Window",
            items: vec![Item::System(Minimize), Item::System(Zoom)],
        },
    ]
}

/// Every item of the menu, nested submenus flattened.
pub fn all_items() -> Vec<Item> {
    fn walk(items: Vec<Item>, out: &mut Vec<Item>) {
        for i in items {
            match i {
                Item::Nested(sub) => walk(sub.items, out),
                other => out.push(other),
            }
        }
    }
    let mut out = Vec::new();
    for s in menu_spec() {
        walk(s.items, &mut out);
    }
    out
}

/// All app command ids in the menu.
pub fn command_ids() -> BTreeSet<&'static str> {
    all_items()
        .into_iter()
        .filter_map(|i| match i {
            Item::Command { id, .. } => Some(id),
            _ => None,
        })
        .collect()
}

#[cfg(target_os = "macos")]
pub fn build<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::Menu;
    let menu = Menu::new(app)?;
    for sub in menu_spec() {
        menu.append(&build_submenu(app, sub)?)?;
    }
    Ok(menu)
}

#[cfg(target_os = "macos")]
fn build_submenu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    sub: Submenu,
) -> tauri::Result<tauri::menu::Submenu<R>> {
    use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu as TSub};
    let s = TSub::new(app, sub.title, true)?;
    {
        for item in sub.items {
            match item {
                Item::Command { id, label, accel } => {
                    s.append(&MenuItem::with_id(app, id, label, true, accel)?)?
                }
                Item::Separator => s.append(&PredefinedMenuItem::separator(app)?)?,
                Item::Nested(inner) => s.append(&build_submenu(app, inner)?)?,
                Item::System(sys) => {
                    let p = match sys {
                        SystemItem::About => {
                            PredefinedMenuItem::about(app, Some("About DevTex"), None)?
                        }
                        SystemItem::Hide => PredefinedMenuItem::hide(app, None)?,
                        SystemItem::HideOthers => PredefinedMenuItem::hide_others(app, None)?,
                        SystemItem::ShowAll => PredefinedMenuItem::show_all(app, None)?,
                        SystemItem::Quit => PredefinedMenuItem::quit(app, None)?,
                        SystemItem::CloseWindow => PredefinedMenuItem::close_window(app, None)?,
                        SystemItem::Undo => PredefinedMenuItem::undo(app, None)?,
                        SystemItem::Redo => PredefinedMenuItem::redo(app, None)?,
                        SystemItem::Cut => PredefinedMenuItem::cut(app, None)?,
                        SystemItem::Copy => PredefinedMenuItem::copy(app, None)?,
                        SystemItem::Paste => PredefinedMenuItem::paste(app, None)?,
                        SystemItem::SelectAll => PredefinedMenuItem::select_all(app, None)?,
                        SystemItem::Minimize => PredefinedMenuItem::minimize(app, None)?,
                        SystemItem::Zoom => PredefinedMenuItem::maximize(app, None)?,
                        SystemItem::Fullscreen => PredefinedMenuItem::fullscreen(app, None)?,
                    };
                    s.append(&p)?
                }
            }
        }
    }
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accels() -> Vec<&'static str> {
        all_items()
            .into_iter()
            .filter_map(|i| match i {
                Item::Command { accel, .. } => accel,
                _ => None,
            })
            .collect()
    }

    #[test]
    fn app_accelerators_are_unique() {
        let a = accels();
        let set: BTreeSet<_> = a.iter().map(|s| s.to_ascii_lowercase()).collect();
        assert_eq!(set.len(), a.len(), "duplicate accelerator in {a:?}");
    }

    #[test]
    fn app_commands_never_take_system_or_reserved_accelerators() {
        let reserved: Vec<String> = SYSTEM_ACCELERATORS
            .iter()
            .map(|s| s.to_ascii_lowercase())
            .chain(
                [
                    "cmdorctrl+ctrl+f",
                    "cmdorctrl+ctrl+q",
                    "cmdorctrl+shift+3",
                    "cmdorctrl+shift+4",
                    "cmdorctrl+shift+5",
                ]
                .map(String::from),
            )
            .collect();
        for a in accels() {
            assert!(
                !reserved.contains(&a.to_ascii_lowercase()),
                "{a} is reserved"
            );
        }
    }

    #[test]
    fn system_items_are_present_once() {
        let systems: Vec<SystemItem> = all_items()
            .into_iter()
            .filter_map(|i| match i {
                Item::System(s) => Some(s),
                _ => None,
            })
            .collect();
        for s in [
            SystemItem::Quit,
            SystemItem::CloseWindow,
            SystemItem::Undo,
            SystemItem::Copy,
            SystemItem::Paste,
            SystemItem::Minimize,
            SystemItem::Hide,
        ] {
            assert_eq!(systems.iter().filter(|x| **x == s).count(), 1, "{s:?}");
        }
    }

    #[test]
    fn command_ids_are_namespaced() {
        for id in command_ids() {
            assert!(id.contains('.'), "{id}");
        }
        assert!(command_ids().contains("compile.pdf"));
        assert!(command_ids().contains("file.openRecent"));
        assert!(command_ids().contains("file.openFile"));
        assert!(command_ids().contains("file.quickOpen"));
        assert!(command_ids().contains("file.closeFile"));
        assert!(command_ids().contains("view.togglePreamble"));
        assert!(command_ids().contains("view.toggleWordWrap"));
        assert!(command_ids().contains("view.toggleScrollLock"));
        assert!(command_ids().contains("edit.moveLineUp"));
        assert!(command_ids().contains("edit.moveLineDown"));
        for id in [
            "view.selectStyleProfile",
            "view.styleProfile.Default",
            "view.styleProfile.Paper",
            "view.styleProfile.HighContrast",
            "view.styleProfile.Solarized",
            "view.zoomIn",
            "view.zoomOut",
            "view.zoomReset",
            "pdf.zoomIn",
            "pdf.zoomOut",
            "pdf.zoomFit",
        ] {
            assert!(command_ids().contains(id), "{id}");
        }
    }
}
