//! Navigation guard: the main webview may only ever show the app itself.
//!
//! A live link in the preview (e.g. MathJax's `\href` before the `html`
//! package was dropped) would otherwise navigate the app's only window to a
//! remote page and throw away the editor's in-memory state.

use tauri::Url;

/// Vite dev server (`build.devUrl` in tauri.conf.json); allowed in debug builds only.
const DEV_ORIGIN: (&str, &str, u16) = ("http", "localhost", 1420);

/// True for URLs served by the app: `tauri://localhost/…` (macOS/iOS),
/// `http(s)://tauri.localhost/…` (other platforms), `about:blank`, and in
/// debug builds the Vite dev server.
pub fn is_app_url(url: &Url, allow_dev: bool) -> bool {
    let host = url.host_str().unwrap_or("");
    match url.scheme() {
        "tauri" => host == "localhost",
        "about" => url.path() == "blank",
        "http" | "https" if host == "tauri.localhost" => true,
        scheme => {
            allow_dev
                && scheme == DEV_ORIGIN.0
                && host == DEV_ORIGIN.1
                && url.port() == Some(DEV_ORIGIN.2)
        }
    }
}

/// Tauri plugin that cancels any top-level navigation away from the app.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("nav-guard")
        .on_navigation(|_webview, url| is_app_url(url, cfg!(debug_assertions)))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn app_origins_are_allowed() {
        assert!(is_app_url(&u("tauri://localhost/"), false));
        assert!(is_app_url(&u("tauri://localhost/index.html#x"), false));
        assert!(is_app_url(&u("http://tauri.localhost/"), false));
        assert!(is_app_url(&u("https://tauri.localhost/"), false));
        assert!(is_app_url(&u("about:blank"), false));
    }

    /// Audit 20261123 (Low): a link in the preview must not navigate the window away.
    #[test]
    fn remote_and_lookalike_urls_are_blocked() {
        for bad in [
            "https://example.com/",
            "http://localhost:1420/",
            "http://localhost:8080/",
            "tauri://evil.com/",
            "https://tauri.localhost.evil.com/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "about:srcdoc",
        ] {
            assert!(!is_app_url(&u(bad), false), "{bad}");
        }
    }

    #[test]
    fn dev_server_only_in_debug() {
        assert!(is_app_url(&u("http://localhost:1420/"), true));
        assert!(!is_app_url(&u("http://localhost:1421/"), true));
        assert!(!is_app_url(&u("https://example.com/"), true));
    }
}
