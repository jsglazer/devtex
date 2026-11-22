//! Better BibTeX JSON-RPC transport. The protocol, caching and offline
//! back-off live in @devtex/core (bbt.ts); this only forwards a request body
//! to the local endpoint with a hard 300 ms timeout so typing never blocks.

use std::time::Duration;

use crate::error::{AppError, AppResult};

/// Better BibTeX's local JSON-RPC endpoint (Zotero must be running).
pub const BBT_ENDPOINT: &str = "http://127.0.0.1:23119/better-bibtex/json-rpc";
pub const BBT_TIMEOUT: Duration = Duration::from_millis(300);

pub async fn post(
    client: &reqwest::Client,
    url: &str,
    body: String,
    timeout: Duration,
) -> AppResult<String> {
    let resp = client
        .post(url)
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .timeout(timeout)
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::Bbt {
            message: if e.is_timeout() {
                format!("no reply within {} ms", timeout.as_millis())
            } else {
                e.to_string()
            },
        })?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| AppError::Bbt {
        message: e.to_string(),
    })?;
    if !status.is_success() {
        return Err(AppError::Bbt {
            message: format!("HTTP {status}"),
        });
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn forwards_body_and_returns_reply() {
        let mut server = mockito::Server::new_async().await;
        let m = server
            .mock("POST", "/better-bibtex/json-rpc")
            .match_body(r#"{"jsonrpc":"2.0","id":1,"method":"api.ready","params":[]}"#)
            .with_body(r#"{"jsonrpc":"2.0","id":1,"result":{"zotero":"7"}}"#)
            .create_async()
            .await;
        let url = format!("{}/better-bibtex/json-rpc", server.url());
        let r = post(
            &reqwest::Client::new(),
            &url,
            r#"{"jsonrpc":"2.0","id":1,"method":"api.ready","params":[]}"#.into(),
            BBT_TIMEOUT,
        )
        .await;
        assert_eq!(
            r.unwrap(),
            r#"{"jsonrpc":"2.0","id":1,"result":{"zotero":"7"}}"#
        );
        m.assert_async().await;
    }

    #[tokio::test]
    async fn closed_port_is_an_error_not_a_hang() {
        // bind then drop to get a port nobody listens on
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let t0 = std::time::Instant::now();
        let r = post(
            &reqwest::Client::new(),
            &format!("http://127.0.0.1:{port}/x"),
            "{}".into(),
            BBT_TIMEOUT,
        )
        .await;
        assert!(matches!(r, Err(AppError::Bbt { .. })));
        assert!(t0.elapsed() < Duration::from_millis(1000));
    }

    #[tokio::test]
    async fn slow_server_times_out_at_300ms() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (_sock, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(5)).await;
        });
        let t0 = std::time::Instant::now();
        let r = post(
            &reqwest::Client::new(),
            &format!("http://{addr}/x"),
            "{}".into(),
            BBT_TIMEOUT,
        )
        .await;
        let el = t0.elapsed();
        match r {
            Err(AppError::Bbt { message }) => assert!(message.contains("300 ms"), "{message}"),
            other => panic!("expected timeout, got {other:?}"),
        }
        assert!(
            el >= Duration::from_millis(290) && el < Duration::from_millis(1500),
            "{el:?}"
        );
    }

    #[test]
    fn production_endpoint_and_timeout_are_fixed() {
        assert!(BBT_ENDPOINT.starts_with("http://127.0.0.1:"));
        assert_eq!(BBT_TIMEOUT.as_millis(), 300);
    }
}
