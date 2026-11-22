use std::fmt;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const MAX_SEARCH_DEPTH: usize = 10;
const MAX_VISITED_ENTRIES: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FsJailError {
    InvalidPath,
    TraversalBlocked,
    SensitivePathDenied,
    Io(String),
}

impl fmt::Display for FsJailError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPath => write!(f, "invalid path"),
            Self::TraversalBlocked => write!(f, "path traversal blocked"),
            Self::SensitivePathDenied => write!(f, "sensitive path denied"),
            Self::Io(msg) => write!(f, "io error: {msg}"),
        }
    }
}

impl std::error::Error for FsJailError {}

fn is_sensitive_component(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    let name = lower.as_str();
    name == ".env"
        || name.starts_with(".env.")
        || matches!(
            name,
            ".ssh"
                | ".gnupg"
                | ".aws"
                | ".kube"
                | ".mso"
                | "id_rsa"
                | "id_ed25519"
                | "credentials.json"
        )
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.starts_with("secrets.")
        || name.starts_with("tokens.")
}

pub fn is_sensitive_path(path: &Path) -> bool {
    for component in path.components() {
        if let Component::Normal(os_str) = component {
            let lossy = os_str.to_string_lossy();
            for segment in lossy.split('\\') {
                if !segment.is_empty() && is_sensitive_component(segment) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn resolve_jailed_path(root: &Path, relative: &str) -> Result<PathBuf, FsJailError> {
    if relative.is_empty() || relative.bytes().any(|b| b == 0) {
        return Err(FsJailError::InvalidPath);
    }
    if relative.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(FsJailError::TraversalBlocked);
    }
    if relative.starts_with('/') || relative.contains('\\') {
        return Err(FsJailError::InvalidPath);
    }

    let rel_path = Path::new(relative);
    if rel_path.is_absolute() {
        return Err(FsJailError::InvalidPath);
    }

    let mut normalized_segments = Vec::new();
    for component in rel_path.components() {
        match component {
            Component::Normal(seg) => normalized_segments.push(seg),
            Component::CurDir => {}
            Component::ParentDir => return Err(FsJailError::TraversalBlocked),
            Component::RootDir | Component::Prefix(_) => return Err(FsJailError::InvalidPath),
        }
    }
    if normalized_segments.is_empty() {
        return Err(FsJailError::InvalidPath);
    }

    if is_sensitive_path(rel_path) {
        return Err(FsJailError::SensitivePathDenied);
    }

    let canonical_root = fs::canonicalize(root).map_err(|e| FsJailError::Io(e.to_string()))?;
    if !canonical_root.is_dir() {
        return Err(FsJailError::InvalidPath);
    }

    let mut candidate = canonical_root.clone();
    for seg in normalized_segments {
        candidate.push(seg);
    }

    let canonical = fs::canonicalize(&candidate).map_err(|e| FsJailError::Io(e.to_string()))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(FsJailError::TraversalBlocked);
    }

    let canonical_rel = canonical
        .strip_prefix(&canonical_root)
        .map_err(|_| FsJailError::TraversalBlocked)?;
    if is_sensitive_path(canonical_rel) {
        return Err(FsJailError::SensitivePathDenied);
    }

    Ok(canonical)
}

fn is_skipped_search_dir(name: &str) -> bool {
    matches!(name.to_ascii_lowercase().as_str(), ".git" | "node_modules")
}

pub fn search_jailed_files(
    root: &Path,
    query: &str,
    max_results: usize,
) -> Result<Vec<String>, FsJailError> {
    let canonical_root = fs::canonicalize(root).map_err(|e| FsJailError::Io(e.to_string()))?;
    if !canonical_root.is_dir() {
        return Err(FsJailError::InvalidPath);
    }
    if max_results == 0 {
        return Ok(Vec::new());
    }

    let needle = query.to_ascii_lowercase();
    let mut results = Vec::new();
    let mut visited = 0usize;

    walk_jailed_dir(
        &canonical_root,
        "",
        0,
        &needle,
        &mut visited,
        &mut results,
    );

    results.sort();
    results.truncate(max_results);
    Ok(results)
}

fn walk_jailed_dir(
    dir: &Path,
    rel_prefix: &str,
    depth: usize,
    needle: &str,
    visited: &mut usize,
    results: &mut Vec<String>,
) {
    if depth > MAX_SEARCH_DEPTH || *visited >= MAX_VISITED_ENTRIES {
        return;
    }

    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };

    let mut entries: Vec<(String, fs::DirEntry)> = Vec::new();
    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        entries.push((name, entry));
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (name, entry) in entries {
        if *visited >= MAX_VISITED_ENTRIES {
            return;
        }
        *visited += 1;

        if is_skipped_search_dir(&name) {
            continue;
        }

        let rel_path = if rel_prefix.is_empty() {
            name.clone()
        } else {
            format!("{rel_prefix}/{name}")
        };
        if is_sensitive_path(Path::new(&rel_path)) {
            continue;
        }

        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if depth < MAX_SEARCH_DEPTH {
                walk_jailed_dir(
                    &entry.path(),
                    &rel_path,
                    depth + 1,
                    needle,
                    visited,
                    results,
                );
            }
        } else if file_type.is_file() && rel_path.to_ascii_lowercase().contains(needle) {
            results.push(rel_path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("mso-rust-fs-jail-{label}-{nanos}-{seq}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sensitive_path_denylist_blocks_credentials_case_insensitively() {
        for blocked in [
            ".env",
            ".ENV",
            ".env.local",
            "app/.env.production",
            ".ssh/config",
            "home/.SSH/authorized_keys",
            ".gnupg/secring.gpg",
            ".aws/credentials",
            ".kube/config",
            ".mso/state.json",
            "keys/id_rsa",
            "keys/ID_RSA",
            "keys/id_ed25519",
            "config/credentials.json",
            "config/Credentials.JSON",
            "certs/server.pem",
            "certs/CA.PEM",
            "certs/private.key",
            "certs/TLS.KEY",
            "config/secrets.yaml",
            "config/SECRETS.json",
            "auth/tokens.json",
            "auth/Tokens.txt",
        ] {
            assert!(
                is_sensitive_path(Path::new(blocked)),
                "expected sensitive path to be blocked: {blocked}"
            );
        }

        for allowed in [
            "README.md",
            "src/main.rs",
            "src/env_loader.rs",
            "docs/keyboard.md",
            "docs/pem_format.txt",
            "src/tokens_counter.rs",
            "src/secrets_docs.md",
            "package.json",
        ] {
            assert!(
                !is_sensitive_path(Path::new(allowed)),
                "expected safe path to be allowed: {allowed}"
            );
        }
    }

    #[test]
    fn resolves_valid_jailed_paths_and_rejects_invalid_and_traversal() {
        let root = temp_dir("resolve");
        fs::create_dir_all(root.join("notes/sub")).unwrap();
        fs::write(root.join("notes/sub/hello.txt"), "hello").unwrap();

        let resolved = resolve_jailed_path(&root, "notes/sub/hello.txt").unwrap();
        assert_eq!(resolved, fs::canonicalize(root.join("notes/sub/hello.txt")).unwrap());

        let resolved_cur = resolve_jailed_path(&root, "./notes/sub/hello.txt").unwrap();
        assert_eq!(resolved_cur, resolved);

        assert_eq!(resolve_jailed_path(&root, ""), Err(FsJailError::InvalidPath));
        assert_eq!(resolve_jailed_path(&root, "."), Err(FsJailError::InvalidPath));
        assert_eq!(resolve_jailed_path(&root, "/etc/passwd"), Err(FsJailError::InvalidPath));
        assert_eq!(resolve_jailed_path(&root, "notes/a\0b.txt"), Err(FsJailError::InvalidPath));
        assert_eq!(resolve_jailed_path(&root, r"notes\sub\hello.txt"), Err(FsJailError::InvalidPath));

        assert_eq!(resolve_jailed_path(&root, ".."), Err(FsJailError::TraversalBlocked));
        assert_eq!(resolve_jailed_path(&root, "../etc/passwd"), Err(FsJailError::TraversalBlocked));
        assert_eq!(resolve_jailed_path(&root, "notes/../../etc/passwd"), Err(FsJailError::TraversalBlocked));
        assert_eq!(resolve_jailed_path(&root, r"notes\..\secret.txt"), Err(FsJailError::TraversalBlocked));

        assert!(matches!(
            resolve_jailed_path(&root, "notes/missing.txt"),
            Err(FsJailError::Io(_))
        ));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_denies_sensitive_files_and_directories() {
        let root = temp_dir("sensitive");
        fs::create_dir_all(root.join(".ssh")).unwrap();
        fs::create_dir_all(root.join(".mso")).unwrap();
        fs::create_dir_all(root.join("certs")).unwrap();
        fs::write(root.join(".env"), "SECRET=1").unwrap();
        fs::write(root.join(".env.local"), "SECRET=2").unwrap();
        fs::write(root.join(".ssh/id_rsa"), "key").unwrap();
        fs::write(root.join(".mso/vault.json"), "{}").unwrap();
        fs::write(root.join("certs/server.pem"), "pem").unwrap();

        for path in [
            ".env",
            ".env.local",
            ".ssh/id_rsa",
            ".mso/vault.json",
            "certs/server.pem",
            "nonexistent/.env",
        ] {
            assert_eq!(
                resolve_jailed_path(&root, path),
                Err(FsJailError::SensitivePathDenied),
                "expected SensitivePathDenied for {path}"
            );
        }

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_blocks_symlink_escape_and_symlink_to_sensitive_target() {
        use std::os::unix::fs::symlink;

        let root = temp_dir("symlink-root");
        let outside = temp_dir("symlink-outside");
        let outside_file = outside.join("secret.txt");
        fs::write(&outside_file, "outside-secret").unwrap();
        fs::write(root.join(".env"), "TOKEN=abc").unwrap();
        fs::write(root.join("real.txt"), "ok").unwrap();

        symlink(&outside_file, root.join("escape.txt")).unwrap();
        symlink(root.join(".env"), root.join("innocent-link.txt")).unwrap();
        symlink(root.join("real.txt"), root.join("safe-link.txt")).unwrap();

        assert_eq!(
            resolve_jailed_path(&root, "escape.txt"),
            Err(FsJailError::TraversalBlocked)
        );
        assert_eq!(
            resolve_jailed_path(&root, "innocent-link.txt"),
            Err(FsJailError::SensitivePathDenied)
        );
        assert_eq!(
            resolve_jailed_path(&root, "safe-link.txt").unwrap(),
            fs::canonicalize(root.join("real.txt")).unwrap()
        );

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn search_jailed_files_skips_git_node_modules_symlinks_sensitive_and_enforces_depth_and_cap() {
        let root = temp_dir("search");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join(".ssh")).unwrap();
        fs::create_dir_all(root.join(".mso")).unwrap();

        fs::write(root.join("src/AppReport.ts"), "1").unwrap();
        fs::write(root.join("docs/report-guide.md"), "2").unwrap();
        fs::write(root.join("a-report.txt"), "3").unwrap();
        fs::write(root.join(".git/objects/report.txt"), "skip git").unwrap();
        fs::write(root.join("node_modules/pkg/report.js"), "skip nm").unwrap();
        fs::write(root.join(".env.report"), "skip env").unwrap();
        fs::write(root.join(".ssh/report_key"), "skip ssh").unwrap();
        fs::write(root.join(".mso/report.json"), "skip mso").unwrap();
        fs::write(root.join("docs/report.pem"), "skip pem").unwrap();
        fs::write(root.join("docs/secrets.report.json"), "skip secrets").unwrap();

        // Build nested directories to test max depth 10 vs depth 11.
        let mut depth10 = root.clone();
        for i in 1..=MAX_SEARCH_DEPTH {
            depth10.push(format!("d{i}"));
        }
        fs::create_dir_all(&depth10).unwrap();
        fs::write(depth10.join("depth10-report.txt"), "ok at depth 10").unwrap();

        let depth11 = depth10.join("d11");
        fs::create_dir_all(&depth11).unwrap();
        fs::write(depth11.join("depth11-report.txt"), "too deep").unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            symlink(root.join("a-report.txt"), root.join("symlink-report.txt")).unwrap();
            symlink(root.join("docs"), root.join("symlink-docs")).unwrap();
        }

        let hits = search_jailed_files(&root, "REPORT", 10).unwrap();
        assert_eq!(
            hits,
            vec![
                "a-report.txt".to_string(),
                "d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/depth10-report.txt".to_string(),
                "docs/report-guide.md".to_string(),
                "src/AppReport.ts".to_string(),
            ]
        );

        let capped = search_jailed_files(&root, "report", 2).unwrap();
        assert_eq!(
            capped,
            vec![
                "a-report.txt".to_string(),
                "d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/depth10-report.txt".to_string(),
            ]
        );

        assert!(search_jailed_files(&root, "report", 0).unwrap().is_empty());

        let _ = fs::remove_dir_all(&root);
    }
}
