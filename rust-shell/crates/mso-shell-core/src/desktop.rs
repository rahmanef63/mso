use crate::origin::{self, HostOrigin, OriginError};
use std::fmt;

const RESERVED_PREFIXES: &[&str] = &[
    "/api",
    "/_next",
    "/mcp",
    "/oauth",
    "/.well-known",
    "/a2a",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopError {
    InvalidProfileId,
    EmptyLabel,
    ControlCharacters,
    InvalidOrigin(OriginError),
    InvalidDeepLinkScheme,
    InvalidDeepLinkAction,
    InvalidDeepLinkSlug,
    InvalidDeepLinkPath,
    ReservedDeepLinkPath,
}

impl fmt::Display for DesktopError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidProfileId => {
                f.write_str("desktop profile id must be 1..=32 chars of [a-z0-9_-]")
            }
            Self::EmptyLabel => f.write_str("desktop profile label must not be empty"),
            Self::ControlCharacters => f.write_str("desktop input contains control characters"),
            Self::InvalidOrigin(err) => write!(f, "invalid desktop host origin: {err}"),
            Self::InvalidDeepLinkScheme => f.write_str("deep link must use the mso:// scheme"),
            Self::InvalidDeepLinkAction => f.write_str("deep link action must be mso://open/<slug>"),
            Self::InvalidDeepLinkSlug => f.write_str("deep link route slug is invalid"),
            Self::InvalidDeepLinkPath => f.write_str("deep link path parameter is invalid"),
            Self::ReservedDeepLinkPath => f.write_str("deep link targets a reserved route prefix"),
        }
    }
}

impl std::error::Error for DesktopError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopHostProfile {
    pub id: String,
    pub label: String,
    pub origin: HostOrigin,
    pub is_local: bool,
}

impl DesktopHostProfile {
    pub fn new(id: &str, label: &str, origin: &str, is_local: bool) -> Result<Self, DesktopError> {
        if !is_valid_profile_id(id) {
            return Err(DesktopError::InvalidProfileId);
        }
        if label.bytes().any(|b| b < 0x20 || b == 0x7f) {
            return Err(DesktopError::ControlCharacters);
        }
        let trimmed_label = label.trim();
        if trimmed_label.is_empty() {
            return Err(DesktopError::EmptyLabel);
        }
        let parsed_origin = if is_local {
            origin::validate_loopback_origin(origin)
        } else {
            origin::validate_remote_host_origin(origin)
        }
        .map_err(DesktopError::InvalidOrigin)?;

        Ok(Self {
            id: id.to_string(),
            label: trimmed_label.to_string(),
            origin: parsed_origin,
            is_local,
        })
    }

    pub fn api_base_origin(&self) -> String {
        self.origin.as_origin_string()
    }
}

fn is_valid_profile_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 32
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_' || *b == b'-')
}

fn is_reserved_route(route: &str) -> bool {
    let lower = route.to_ascii_lowercase();
    RESERVED_PREFIXES
        .iter()
        .any(|prefix| lower == *prefix || lower.starts_with(&format!("{prefix}/")))
}

fn contains_encoded_danger(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    lower.contains("%00")
        || lower.contains("%0a")
        || lower.contains("%0d")
        || lower.contains("%2e")
        || lower.contains("%2f")
        || lower.contains("%5c")
}

pub fn parse_deep_link(uri: &str) -> Result<String, DesktopError> {
    if uri.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err(DesktopError::ControlCharacters);
    }
    if uri.is_empty() {
        return Err(DesktopError::InvalidDeepLinkScheme);
    }
    if uri.contains('\\') || uri.contains('#') || uri.bytes().any(|b| b == b' ') {
        return Err(DesktopError::InvalidDeepLinkPath);
    }
    if contains_encoded_danger(uri) {
        return Err(DesktopError::InvalidDeepLinkPath);
    }

    let Some(after_scheme) = uri.strip_prefix("mso://") else {
        return Err(DesktopError::InvalidDeepLinkScheme);
    };
    let Some(after_open) = after_scheme.strip_prefix("open/") else {
        return Err(DesktopError::InvalidDeepLinkAction);
    };

    let (slug_part, query_opt) = match after_open.split_once('?') {
        Some((s, q)) => (s, Some(q)),
        None => (after_open, None),
    };

    if slug_part.is_empty() || slug_part.starts_with('/') || slug_part.ends_with('/') {
        return Err(DesktopError::InvalidDeepLinkSlug);
    }

    for segment in slug_part.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(DesktopError::InvalidDeepLinkPath);
        }
    }

    let candidate_route = format!("/{slug_part}");
    if is_reserved_route(&candidate_route) {
        return Err(DesktopError::ReservedDeepLinkPath);
    }

    for segment in slug_part.split('/') {
        if !segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(DesktopError::InvalidDeepLinkSlug);
        }
    }

    let Some(query) = query_opt else {
        return Ok(candidate_route);
    };

    if query.is_empty() || query.contains('?') || query.contains('&') {
        return Err(DesktopError::InvalidDeepLinkPath);
    }
    let Some(rel_path) = query.strip_prefix("path=") else {
        return Err(DesktopError::InvalidDeepLinkPath);
    };
    validate_relative_path(rel_path)?;

    Ok(format!("{candidate_route}?path={rel_path}"))
}

fn validate_relative_path(rel_path: &str) -> Result<(), DesktopError> {
    if rel_path.is_empty()
        || rel_path.starts_with('/')
        || rel_path.ends_with('/')
        || rel_path.contains("..")
        || rel_path.contains(':')
    {
        return Err(DesktopError::InvalidDeepLinkPath);
    }
    if rel_path.bytes().any(|b| {
        b <= 0x20
            || b >= 0x7f
            || matches!(
                b,
                b'\\' | b'?' | b'#' | b'<' | b'>' | b'"' | b'\'' | b'`' | b';'
            )
    }) {
        return Err(DesktopError::InvalidDeepLinkPath);
    }
    for segment in rel_path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(DesktopError::InvalidDeepLinkPath);
        }
    }
    Ok(())
}

pub fn render_bridge_bootstrap_json(profile: &DesktopHostProfile, shell_version: &str) -> String {
    format!(
        r#"{{"mode":"tauri-desktop","apiBaseOrigin":"{}","profileId":"{}","shellVersion":"{}"}}"#,
        escape_json_str(&profile.origin.as_origin_string()),
        escape_json_str(&profile.id),
        escape_json_str(shell_version),
    )
}

fn escape_json_str(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\x08' => out.push_str("\\b"),
            '\x0c' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '<' => out.push_str("\\u003c"),
            '>' => out.push_str("\\u003e"),
            '&' => out.push_str("\\u0026"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c if (c as u32) < 0x20 || c == '\x7f' => {
                use std::fmt::Write as _;
                let _ = write!(&mut out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_local_and_remote_desktop_host_profiles() {
        let local = DesktopHostProfile::new(
            "local_dev-1",
            "  Local MSO  ",
            "http://127.0.0.1:4005",
            true,
        )
        .unwrap();
        assert_eq!(local.id, "local_dev-1");
        assert_eq!(local.label, "Local MSO");
        assert_eq!(local.api_base_origin(), "http://127.0.0.1:4005");
        assert!(local.is_local);

        let local_v6 = DesktopHostProfile::new(
            "loopback-v6",
            "IPv6 Local",
            "https://[::1]:8443",
            true,
        )
        .unwrap();
        assert_eq!(local_v6.api_base_origin(), "https://[::1]:8443");

        // Local profile rejects non-loopback origins
        assert_eq!(
            DesktopHostProfile::new("bad-local", "Remote", "https://mso.example.com", true),
            Err(DesktopError::InvalidOrigin(OriginError::LoopbackRequired))
        );

        // Remote profile accepts HTTPS and rejects plain HTTP on non-loopback hosts
        let remote = DesktopHostProfile::new(
            "prod_vps",
            "Production VPS",
            "https://mso.example.com:8443",
            false,
        )
        .unwrap();
        assert_eq!(remote.api_base_origin(), "https://mso.example.com:8443");
        assert!(!remote.is_local);

        assert_eq!(
            DesktopHostProfile::new("prod-http", "Insecure", "http://mso.example.com", false),
            Err(DesktopError::InvalidOrigin(
                OriginError::HttpsRequiredForRemote
            ))
        );

        // Remote profile still allows loopback over HTTP when explicitly configured
        let remote_loopback = DesktopHostProfile::new(
            "tunnel_local",
            "SSH Tunnel",
            "http://localhost:4005",
            false,
        )
        .unwrap();
        assert_eq!(remote_loopback.api_base_origin(), "http://localhost:4005");

        // Profile id validation: [a-z0-9_-]{1,32}
        let max_id = "a1_b2-c3_d4-e5_f6-g7_h8-i9_j0-k1";
        assert_eq!(max_id.len(), 32);
        assert!(DesktopHostProfile::new(max_id, "Max ID", "http://127.0.0.1:4005", true).is_ok());

        for bad_id in [
            "",
            "a1_b2-c3_d4-e5_f6-g7_h8-i9_j0-k1x",
            "Upper",
            "with space",
            "has.dot",
            "has/slash",
            "id\0nul",
        ] {
            assert_eq!(
                DesktopHostProfile::new(bad_id, "Label", "http://127.0.0.1:4005", true),
                Err(DesktopError::InvalidProfileId),
                "expected InvalidProfileId for {bad_id:?}"
            );
        }

        // Label validation
        assert_eq!(
            DesktopHostProfile::new("ok", "", "http://127.0.0.1:4005", true),
            Err(DesktopError::EmptyLabel)
        );
        assert_eq!(
            DesktopHostProfile::new("ok", "   ", "http://127.0.0.1:4005", true),
            Err(DesktopError::EmptyLabel)
        );
        assert_eq!(
            DesktopHostProfile::new("ok", "Bad\nLabel", "http://127.0.0.1:4005", true),
            Err(DesktopError::ControlCharacters)
        );
        assert_eq!(
            DesktopHostProfile::new("ok", "Bad\0Label", "http://127.0.0.1:4005", true),
            Err(DesktopError::ControlCharacters)
        );
    }

    #[test]
    fn parses_valid_deep_links_and_rejects_traversal_controls_and_reserved_prefixes() {
        assert_eq!(parse_deep_link("mso://open/files").unwrap(), "/files");
        assert_eq!(parse_deep_link("mso://open/editor").unwrap(), "/editor");
        assert_eq!(parse_deep_link("mso://open/workflows").unwrap(), "/workflows");
        assert_eq!(
            parse_deep_link("mso://open/agent-vault").unwrap(),
            "/agent-vault"
        );
        assert_eq!(
            parse_deep_link("mso://open/editor?path=src/lib/app.ts").unwrap(),
            "/editor?path=src/lib/app.ts"
        );
        assert_eq!(
            parse_deep_link("mso://open/files?path=docs/readme.md").unwrap(),
            "/files?path=docs/readme.md"
        );

        // Scheme & action rejections
        for bad_scheme in [
            "",
            "http://open/files",
            "https://open/files",
            "javascript:alert(1)",
            "file:///etc/passwd",
        ] {
            assert_eq!(
                parse_deep_link(bad_scheme),
                Err(DesktopError::InvalidDeepLinkScheme),
                "expected InvalidDeepLinkScheme for {bad_scheme:?}"
            );
        }
        for bad_action in ["mso://exec/run", "mso://files", "mso://open"] {
            assert_eq!(
                parse_deep_link(bad_action),
                Err(DesktopError::InvalidDeepLinkAction),
                "expected InvalidDeepLinkAction for {bad_action:?}"
            );
        }

        // Reserved prefixes must be rejected (case-insensitive)
        for reserved in [
            "mso://open/api",
            "mso://open/api/auth/me",
            "mso://open/API/v1/sys/stats",
            "mso://open/_next",
            "mso://open/_next/static/app.js",
            "mso://open/mcp",
            "mso://open/mcp/session",
            "mso://open/oauth",
            "mso://open/oauth/token",
            "mso://open/.well-known",
            "mso://open/.well-known/agent-card.json",
            "mso://open/a2a",
            "mso://open/a2a/v1",
        ] {
            assert_eq!(
                parse_deep_link(reserved),
                Err(DesktopError::ReservedDeepLinkPath),
                "expected ReservedDeepLinkPath for {reserved:?}"
            );
        }

        // Traversal, control characters, NULs, backslashes, absolute paths, bad queries
        for bad in [
            "mso://open/",
            "mso://open//files",
            "mso://open/files/",
            "mso://open/..",
            "mso://open/files/../secret",
            "mso://open/%2e%2e/secret",
            "mso://open/files\\secret",
            "mso://open/files\0",
            "mso://open/files\r\nX-Injected: 1",
            "mso://open/files?path=a%00b",
            "mso://open/files?path=../etc/passwd",
            "mso://open/files?path=a/../../etc/passwd",
            "mso://open/files?path=%2e%2e/etc/passwd",
            "mso://open/files?path=/etc/passwd",
            "mso://open/files?path=C:/Windows/win.ini",
            "mso://open/files?path=a\\b",
            "mso://open/files?path=",
            "mso://open/files?",
            "mso://open/files?foo=bar",
            "mso://open/files?path=a.txt&extra=1",
            "mso://open/files#fragment",
            "mso://open/files?path=a.txt#frag",
        ] {
            assert!(
                parse_deep_link(bad).is_err(),
                "expected error for malicious deep link {bad:?}"
            );
        }
    }

    #[test]
    fn renders_escaped_bridge_bootstrap_json() {
        let local = DesktopHostProfile::new(
            "local-dev",
            "Local Host",
            "http://127.0.0.1:4005",
            true,
        )
        .unwrap();
        assert_eq!(
            render_bridge_bootstrap_json(&local, "0.1.0"),
            r#"{"mode":"tauri-desktop","apiBaseOrigin":"http://127.0.0.1:4005","profileId":"local-dev","shellVersion":"0.1.0"}"#
        );

        let remote = DesktopHostProfile::new(
            "prod_1",
            "Prod",
            "https://mso.example.com",
            false,
        )
        .unwrap();
        assert_eq!(
            render_bridge_bootstrap_json(&remote, "1.2.3"),
            r#"{"mode":"tauri-desktop","apiBaseOrigin":"https://mso.example.com","profileId":"prod_1","shellVersion":"1.2.3"}"#
        );

        // Verify hostile shell_version characters are safely JSON & HTML-script escaped
        let tricky = "0.1.0\"\\</script>&\n\r\t\x00\x07\u{2028}\u{2029}";
        let json = render_bridge_bootstrap_json(&remote, tricky);
        assert_eq!(
            json,
            r#"{"mode":"tauri-desktop","apiBaseOrigin":"https://mso.example.com","profileId":"prod_1","shellVersion":"0.1.0\"\\\u003c/script\u003e\u0026\n\r\t\u0000\u0007\u2028\u2029"}"#
        );
        assert!(!json.contains("</script>"));
        assert!(!json.contains('\n'));
        assert!(!json.contains('\0'));
    }
}
