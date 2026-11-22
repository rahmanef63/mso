use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct AssetRoot {
    canonical_root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedAsset {
    pub path: PathBuf,
    pub content_type: &'static str,
    pub immutable: bool,
    pub is_html: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssetError {
    BadPath,
    ReservedPath,
    NotFound,
}

const RESERVED_PREFIXES: &[&str] = &[
    "/api",
    "/_next",
    "/mcp",
    "/oauth",
    "/.well-known",
    "/a2a",
];

impl AssetRoot {
    pub fn open(root: impl AsRef<Path>) -> io::Result<Self> {
        let canonical_root = fs::canonicalize(root)?;
        if !canonical_root.is_dir() {
            return Err(io::Error::new(io::ErrorKind::NotADirectory, "asset root is not a directory"));
        }
        Ok(Self { canonical_root })
    }

    pub fn resolve(&self, raw_target: &str) -> Result<ResolvedAsset, AssetError> {
        let path_only = raw_target.split_once('?').map_or(raw_target, |(p, _)| p);
        if !path_only.starts_with('/') || has_unsafe_path_bytes(path_only) {
            return Err(AssetError::BadPath);
        }
        if is_reserved(path_only) {
            return Err(AssetError::ReservedPath);
        }

        let rel = path_only.trim_start_matches('/');
        if rel.is_empty() {
            return self.resolve_index();
        }

        let mut candidate = self.canonical_root.clone();
        for segment in rel.split('/') {
            if segment.is_empty() || segment == "." || segment == ".." {
                return Err(AssetError::BadPath);
            }
            candidate.push(segment);
        }
        if candidate.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err(AssetError::BadPath);
        }

        if let Ok(canon) = fs::canonicalize(&candidate) {
            if !canon.starts_with(&self.canonical_root) {
                return Err(AssetError::BadPath);
            }
            if canon.is_file() {
                let ct = content_type_for(&canon);
                return Ok(ResolvedAsset {
                    is_html: ct.starts_with("text/html"),
                    immutable: path_only.starts_with("/_app/immutable/"),
                    content_type: ct,
                    path: canon,
                });
            }
        }

        // Only extensionless client navigation paths fall back to index.html;
        // missing static chunks/assets must return 404 (never wrong-MIME HTML).
        let last_segment = rel.rsplit('/').next().unwrap_or("");
        if last_segment.contains('.') {
            return Err(AssetError::NotFound);
        }
        self.resolve_index()
    }

    fn resolve_index(&self) -> Result<ResolvedAsset, AssetError> {
        let index = self.canonical_root.join("index.html");
        let canon = fs::canonicalize(&index).map_err(|_| AssetError::NotFound)?;
        if !canon.starts_with(&self.canonical_root) || !canon.is_file() {
            return Err(AssetError::BadPath);
        }
        Ok(ResolvedAsset {
            path: canon,
            content_type: "text/html; charset=utf-8",
            immutable: false,
            is_html: true,
        })
    }
}

fn has_unsafe_path_bytes(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    path.bytes().any(|b| b == 0 || b == b'\\' || b < 0x20 || b == 0x7f)
        || lower.contains("%2e")
        || lower.contains("%2f")
        || lower.contains("%5c")
        || lower.contains("%00")
}

fn is_reserved(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    RESERVED_PREFIXES
        .iter()
        .any(|prefix| lower == *prefix || lower.starts_with(&format!("{prefix}/")))
}

fn content_type_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-assets-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolves_assets_and_blocks_traversal_and_reserved_paths() {
        let dir = temp_dir("basic");
        fs::create_dir_all(dir.join("_app/immutable/entry")).unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();
        fs::write(dir.join("_app/immutable/entry/app.js"), "console.log(1)").unwrap();

        let root = AssetRoot::open(&dir).unwrap();
        assert!(root.resolve("/").unwrap().is_html);
        assert!(root.resolve("/files/home").unwrap().is_html);
        let js = root.resolve("/_app/immutable/entry/app.js?v=1").unwrap();
        assert!(js.immutable);
        assert_eq!(js.content_type, "application/javascript; charset=utf-8");

        assert_eq!(root.resolve("/_app/immutable/missing.js"), Err(AssetError::NotFound));
        assert_eq!(root.resolve("/api/auth/me"), Err(AssetError::ReservedPath));
        assert_eq!(root.resolve("/_next/static/chunk.js"), Err(AssetError::ReservedPath));
        assert_eq!(root.resolve("/mcp"), Err(AssetError::ReservedPath));
        assert_eq!(root.resolve("/../etc/passwd"), Err(AssetError::BadPath));
        assert_eq!(root.resolve("/%2e%2e/secret"), Err(AssetError::BadPath));
        assert_eq!(root.resolve("/a\\b"), Err(AssetError::BadPath));

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn blocks_symlink_escaping_asset_root() {
        use std::os::unix::fs::symlink;
        let dir = temp_dir("symlink");
        let outside = temp_dir("outside");
        let secret = outside.join("secret.txt");
        fs::write(&secret, "secret").unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();
        symlink(&secret, dir.join("leak.txt")).unwrap();

        let root = AssetRoot::open(&dir).unwrap();
        assert_eq!(root.resolve("/leak.txt"), Err(AssetError::BadPath));

        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }
}
