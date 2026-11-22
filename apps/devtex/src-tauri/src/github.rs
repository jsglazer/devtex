//! Single-commit review push through the GitHub Git Data API (no local git):
//!
//! 1. `GET  /repos/{o}/{r}/git/ref/heads/{branch}`      -> head commit
//! 2. `GET  /repos/{o}/{r}/git/commits/{head}`          -> base tree
//! 3. `GET  /repos/{o}/{r}/git/trees/{tree}?recursive=1` -> remote blob SHAs
//!    remote-change check: refuse if a remote file's SHA differs from the SHA
//!    DevTex last pushed for it (markup-reviewer convention)
//! 4. `POST /repos/{o}/{r}/git/blobs` per file (base64)
//! 5. `POST /repos/{o}/{r}/git/trees` with `base_tree`
//! 6. `POST /repos/{o}/{r}/git/commits`
//! 7. `PATCH /repos/{o}/{r}/git/refs/heads/{branch}` (`force: false`)
//!
//! The base URL is injectable so tests run against a mock HTTP server with a
//! fake token. 401/403/404/409/422 map to typed errors.

use std::collections::BTreeMap;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{AppError, AppResult};

pub const GITHUB_API: &str = "https://api.github.com";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoTarget {
    pub owner: String,
    pub repo: String,
    pub branch: String,
}

#[derive(Debug, Clone)]
pub struct PushFile {
    pub repo_path: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushOutcome {
    pub commit_sha: String,
    /// repo path -> blob SHA now on the branch (persisted as "last pushed").
    pub blob_shas: BTreeMap<String, String>,
}

pub struct GitDataClient {
    http: reqwest::Client,
    base: String,
    token: String,
    target: RepoTarget,
}

#[derive(Deserialize)]
struct RefResp {
    object: ShaObj,
}
#[derive(Deserialize)]
struct ShaObj {
    sha: String,
}
#[derive(Deserialize)]
struct CommitResp {
    tree: ShaObj,
}
#[derive(Deserialize)]
struct TreeResp {
    tree: Vec<TreeEntry>,
    #[serde(default)]
    truncated: bool,
}
#[derive(Deserialize)]
struct TreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    sha: String,
}
#[derive(Deserialize)]
struct ShaResp {
    sha: String,
}
#[derive(Deserialize, Default)]
struct GhError {
    #[serde(default)]
    message: String,
}

/// Map a non-success status to a typed error.
pub fn status_error(status: u16, body: &str) -> AppError {
    let message = serde_json::from_str::<GhError>(body)
        .map(|e| e.message)
        .unwrap_or_else(|_| body.chars().take(200).collect());
    match status {
        401 => AppError::Unauthorized,
        403 => AppError::Forbidden { message },
        404 => AppError::GithubNotFound { message },
        409 => AppError::GithubConflict { message },
        422 => AppError::Unprocessable { message },
        _ => AppError::Github { status, message },
    }
}

/// Paths whose remote SHA no longer matches the SHA DevTex last pushed, and
/// paths that exist remotely but were never pushed by DevTex.
pub fn remote_changes(
    files: &[PushFile],
    remote: &BTreeMap<String, String>,
    last_pushed: &BTreeMap<String, String>,
) -> (Vec<String>, Vec<String>) {
    let mut changed = Vec::new();
    let mut untracked = Vec::new();
    for f in files {
        match (remote.get(&f.repo_path), last_pushed.get(&f.repo_path)) {
            (Some(r), Some(l)) if r != l => changed.push(f.repo_path.clone()),
            (Some(_), None) => untracked.push(f.repo_path.clone()),
            _ => {}
        }
    }
    (changed, untracked)
}

impl GitDataClient {
    pub fn new(http: reqwest::Client, base: &str, token: &str, target: RepoTarget) -> Self {
        Self {
            http,
            base: base.trim_end_matches('/').to_string(),
            token: token.to_string(),
            target,
        }
    }

    fn url(&self, tail: &str) -> String {
        format!(
            "{}/repos/{}/{}/git/{}",
            self.base, self.target.owner, self.target.repo, tail
        )
    }

    async fn send<T: for<'de> Deserialize<'de>>(
        &self,
        req: reqwest::RequestBuilder,
    ) -> AppResult<T> {
        let resp = req
            .bearer_auth(&self.token)
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28")
            .header("user-agent", "DevTex")
            .send()
            .await
            .map_err(|e| AppError::Network {
                message: e.to_string(),
            })?;
        let status = resp.status().as_u16();
        let text = resp.text().await.map_err(|e| AppError::Network {
            message: e.to_string(),
        })?;
        if !(200..300).contains(&status) {
            return Err(status_error(status, &text));
        }
        serde_json::from_str(&text).map_err(|e| AppError::Github {
            status,
            message: format!("unexpected response: {e}"),
        })
    }

    pub async fn push(
        &self,
        files: &[PushFile],
        message: &str,
        last_pushed: &BTreeMap<String, String>,
        allow_untracked: bool,
    ) -> AppResult<PushOutcome> {
        let branch = &self.target.branch;
        let head: RefResp = self
            .send(self.http.get(self.url(&format!("ref/heads/{branch}"))))
            .await?;
        let head_sha = head.object.sha;
        let commit: CommitResp = self
            .send(self.http.get(self.url(&format!("commits/{head_sha}"))))
            .await?;
        let base_tree = commit.tree.sha;

        let tree: TreeResp = self
            .send(
                self.http
                    .get(self.url(&format!("trees/{base_tree}?recursive=1"))),
            )
            .await?;
        if tree.truncated {
            return Err(AppError::Github {
                status: 200,
                message: "repository tree too large to verify remote changes".into(),
            });
        }
        let remote: BTreeMap<String, String> = tree
            .tree
            .into_iter()
            .filter(|e| e.kind == "blob")
            .map(|e| (e.path, e.sha))
            .collect();
        let (changed, untracked) = remote_changes(files, &remote, last_pushed);
        if !changed.is_empty() {
            return Err(AppError::RemoteChanged { paths: changed });
        }
        if !untracked.is_empty() && !allow_untracked {
            return Err(AppError::RemoteUntracked { paths: untracked });
        }

        let b64 = base64::engine::general_purpose::STANDARD;
        let mut blob_shas = BTreeMap::new();
        let mut entries = Vec::new();
        for f in files {
            let blob: ShaResp = self
                .send(
                    self.http
                        .post(self.url("blobs"))
                        .json(&json!({ "content": b64.encode(&f.bytes), "encoding": "base64" })),
                )
                .await?;
            entries.push(
                json!({ "path": f.repo_path, "mode": "100644", "type": "blob", "sha": blob.sha }),
            );
            blob_shas.insert(f.repo_path.clone(), blob.sha);
        }
        let new_tree: ShaResp = self
            .send(
                self.http
                    .post(self.url("trees"))
                    .json(&json!({ "base_tree": base_tree, "tree": entries })),
            )
            .await?;
        let new_commit: ShaResp = self
            .send(
                self.http.post(self.url("commits")).json(
                    &json!({ "message": message, "tree": new_tree.sha, "parents": [head_sha] }),
                ),
            )
            .await?;
        let _: serde_json::Value = self
            .send(
                self.http
                    .patch(self.url(&format!("refs/heads/{branch}")))
                    .json(&json!({ "sha": new_commit.sha, "force": false })),
            )
            .await?;
        Ok(PushOutcome {
            commit_sha: new_commit.sha,
            blob_shas,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server, ServerGuard};

    const TOKEN: &str = "test-token-not-real";

    fn target() -> RepoTarget {
        RepoTarget {
            owner: "someone".into(),
            repo: "reviews".into(),
            branch: "main".into(),
        }
    }

    fn files() -> Vec<PushFile> {
        vec![
            PushFile {
                repo_path: "thesis/main.tex".into(),
                bytes: b"\\documentclass{report}".to_vec(),
            },
            PushFile {
                repo_path: "thesis/ch/one.tex".into(),
                bytes: b"One".to_vec(),
            },
            PushFile {
                repo_path: "thesis/main.pdf".into(),
                bytes: vec![0x25, 0x50, 0x44, 0x46, 0x00, 0xff],
            },
        ]
    }

    async fn mock_reads(server: &mut ServerGuard, tree_json: &str) -> Vec<mockito::Mock> {
        vec![
            server
                .mock("GET", "/repos/someone/reviews/git/ref/heads/main")
                .match_header("authorization", format!("Bearer {TOKEN}").as_str())
                .with_body(r#"{"object":{"sha":"head1"}}"#)
                .create_async()
                .await,
            server
                .mock("GET", "/repos/someone/reviews/git/commits/head1")
                .with_body(r#"{"tree":{"sha":"tree1"}}"#)
                .create_async()
                .await,
            server
                .mock("GET", "/repos/someone/reviews/git/trees/tree1")
                .match_query(Matcher::UrlEncoded("recursive".into(), "1".into()))
                .with_body(tree_json)
                .create_async()
                .await,
        ]
    }

    #[tokio::test]
    async fn pushes_all_files_as_one_commit_in_blob_tree_commit_ref_order() {
        let mut server = Server::new_async().await;
        let reads = mock_reads(&mut server, r#"{"tree":[{"path":"thesis/main.tex","type":"blob","sha":"old-main"},{"path":"other.txt","type":"blob","sha":"x"}],"truncated":false}"#).await;
        let blob = server
            .mock("POST", "/repos/someone/reviews/git/blobs")
            .match_body(Matcher::PartialJson(json!({ "encoding": "base64" })))
            .with_status(201)
            .with_body_from_request(|req| {
                let body: serde_json::Value = serde_json::from_slice(req.body().unwrap()).unwrap();
                format!(
                    r#"{{"sha":"blob-{}"}}"#,
                    body["content"].as_str().unwrap().len()
                )
                .into_bytes()
            })
            .expect(3)
            .create_async()
            .await;
        let tree = server
            .mock("POST", "/repos/someone/reviews/git/trees")
            .match_body(Matcher::PartialJson(json!({ "base_tree": "tree1" })))
            .with_status(201)
            .with_body(r#"{"sha":"tree2"}"#)
            .create_async()
            .await;
        let commit = server
            .mock("POST", "/repos/someone/reviews/git/commits")
            .match_body(Matcher::Json(json!({ "message": "Review: main.tex 20261122-101500", "tree": "tree2", "parents": ["head1"] })))
            .with_status(201)
            .with_body(r#"{"sha":"commit2"}"#)
            .create_async()
            .await;
        let r#ref = server
            .mock("PATCH", "/repos/someone/reviews/git/refs/heads/main")
            .match_body(Matcher::Json(json!({ "sha": "commit2", "force": false })))
            .with_body(r#"{"object":{"sha":"commit2"}}"#)
            .create_async()
            .await;

        let client = GitDataClient::new(reqwest::Client::new(), &server.url(), TOKEN, target());
        let last = BTreeMap::from([("thesis/main.tex".to_string(), "old-main".to_string())]);
        let out = client
            .push(&files(), "Review: main.tex 20261122-101500", &last, false)
            .await
            .unwrap();
        assert_eq!(out.commit_sha, "commit2");
        assert_eq!(out.blob_shas.len(), 3);
        assert!(out.blob_shas.contains_key("thesis/main.pdf"));
        for m in reads {
            m.assert_async().await;
        }
        blob.assert_async().await;
        tree.assert_async().await;
        commit.assert_async().await;
        r#ref.assert_async().await;
    }

    #[tokio::test]
    async fn refuses_when_remote_file_changed_since_last_push() {
        let mut server = Server::new_async().await;
        let _reads = mock_reads(
            &mut server,
            r#"{"tree":[{"path":"thesis/main.tex","type":"blob","sha":"edited-by-reviewer"}]}"#,
        )
        .await;
        let blob = server
            .mock("POST", "/repos/someone/reviews/git/blobs")
            .expect(0)
            .create_async()
            .await;
        let client = GitDataClient::new(reqwest::Client::new(), &server.url(), TOKEN, target());
        let last = BTreeMap::from([("thesis/main.tex".to_string(), "old-main".to_string())]);
        let err = client.push(&files(), "m", &last, false).await.unwrap_err();
        assert_eq!(
            err,
            AppError::RemoteChanged {
                paths: vec!["thesis/main.tex".into()]
            }
        );
        blob.assert_async().await;
    }

    #[tokio::test]
    async fn untracked_remote_files_need_explicit_permission() {
        let mut server = Server::new_async().await;
        let _reads = mock_reads(
            &mut server,
            r#"{"tree":[{"path":"thesis/ch/one.tex","type":"blob","sha":"someone-else"}]}"#,
        )
        .await;
        let client = GitDataClient::new(reqwest::Client::new(), &server.url(), TOKEN, target());
        let err = client
            .push(&files(), "m", &BTreeMap::new(), false)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            AppError::RemoteUntracked {
                paths: vec!["thesis/ch/one.tex".into()]
            }
        );
    }

    async fn ref_status(status: usize, body: &str) -> AppError {
        let mut server = Server::new_async().await;
        let _m = server
            .mock("GET", "/repos/someone/reviews/git/ref/heads/main")
            .with_status(status)
            .with_body(body)
            .create_async()
            .await;
        let client = GitDataClient::new(reqwest::Client::new(), &server.url(), TOKEN, target());
        client
            .push(&files(), "m", &BTreeMap::new(), false)
            .await
            .unwrap_err()
    }

    #[tokio::test]
    async fn maps_401_403_404_409() {
        assert_eq!(
            ref_status(401, r#"{"message":"Bad credentials"}"#).await,
            AppError::Unauthorized
        );
        assert_eq!(
            ref_status(
                403,
                r#"{"message":"Resource not accessible by personal access token"}"#
            )
            .await,
            AppError::Forbidden {
                message: "Resource not accessible by personal access token".into()
            }
        );
        assert_eq!(
            ref_status(404, r#"{"message":"Not Found"}"#).await,
            AppError::GithubNotFound {
                message: "Not Found".into()
            }
        );
        assert_eq!(
            ref_status(409, r#"{"message":"Git Repository is empty."}"#).await,
            AppError::GithubConflict {
                message: "Git Repository is empty.".into()
            }
        );
        assert_eq!(
            ref_status(500, "oops").await,
            AppError::Github {
                status: 500,
                message: "oops".into()
            }
        );
    }

    #[tokio::test]
    async fn maps_422_on_non_fast_forward_ref_update() {
        let mut server = Server::new_async().await;
        let _reads = mock_reads(&mut server, r#"{"tree":[]}"#).await;
        let _b = server
            .mock("POST", "/repos/someone/reviews/git/blobs")
            .with_status(201)
            .with_body(r#"{"sha":"b"}"#)
            .create_async()
            .await;
        let _t = server
            .mock("POST", "/repos/someone/reviews/git/trees")
            .with_status(201)
            .with_body(r#"{"sha":"t"}"#)
            .create_async()
            .await;
        let _c = server
            .mock("POST", "/repos/someone/reviews/git/commits")
            .with_status(201)
            .with_body(r#"{"sha":"c"}"#)
            .create_async()
            .await;
        let _r = server
            .mock("PATCH", "/repos/someone/reviews/git/refs/heads/main")
            .with_status(422)
            .with_body(r#"{"message":"Update is not a fast forward"}"#)
            .create_async()
            .await;
        let client = GitDataClient::new(reqwest::Client::new(), &server.url(), TOKEN, target());
        let err = client
            .push(&files(), "m", &BTreeMap::new(), false)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            AppError::Unprocessable {
                message: "Update is not a fast forward".into()
            }
        );
    }

    #[test]
    fn remote_change_classification() {
        let fs = files();
        let remote = BTreeMap::from([
            ("thesis/main.tex".to_string(), "a".to_string()),
            ("thesis/ch/one.tex".to_string(), "b".to_string()),
        ]);
        let last = BTreeMap::from([("thesis/main.tex".to_string(), "a".to_string())]);
        assert_eq!(
            remote_changes(&fs, &remote, &last),
            (vec![], vec!["thesis/ch/one.tex".to_string()])
        );
    }
}
