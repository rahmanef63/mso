use std::fs::File;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static FALLBACK_COUNTER: AtomicU64 = AtomicU64::new(1);

pub fn generate_nonce() -> String {
    let mut bytes = [0u8; 16];
    let filled = File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .is_ok();
    if !filled {
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        let c = FALLBACK_COUNTER.fetch_add(1, Ordering::Relaxed);
        let p = u64::from(std::process::id());
        let hi = t.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ c.rotate_left(17);
        let lo = (c ^ p.rotate_left(31)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        bytes[..8].copy_from_slice(&hi.to_le_bytes());
        bytes[8..].copy_from_slice(&lo.to_le_bytes());
    }
    let mut out = String::with_capacity(32);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

pub fn build_csp_header(nonce: &str) -> String {
    format!(
        "default-src 'self'; script-src 'self' 'nonce-{nonce}'; style-src 'self' 'unsafe-inline'; \
         img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; \
         base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    )
}

/// Injects a per-request CSP `nonce` attribute into HTML `<script>` opening tags
/// so SvelteKit's static bootstrap script executes without `'unsafe-inline'`.
pub fn inject_script_nonces(html: &str, nonce: &str) -> String {
    let mut out = String::with_capacity(html.len() + 64);
    let mut rest = html;
    while let Some(pos) = rest.find("<script") {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + 7..];
        let next_char = after.as_bytes().first().copied();
        let is_tag_boundary = matches!(next_char, Some(b'>' | b' ' | b'\t' | b'\r' | b'\n'));
        if !is_tag_boundary {
            out.push_str("<script");
            rest = after;
            continue;
        }
        let Some(end_idx) = after.find('>') else {
            out.push_str("<script");
            rest = after;
            break;
        };
        let attrs = &after[..end_idx];
        if attrs.to_ascii_lowercase().contains("nonce=") {
            out.push_str("<script");
            out.push_str(attrs);
            out.push('>');
        } else {
            out.push_str("<script nonce=\"");
            out.push_str(nonce);
            out.push('"');
            out.push_str(attrs);
            out.push('>');
        }
        rest = &after[end_idx + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_unique_hex_nonces() {
        let a = generate_nonce();
        let b = generate_nonce();
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn injects_nonce_into_inline_and_src_script_tags() {
        let html = "<html><body><script>boot()</script><script type=\"module\" src=\"/a.js\"></script></body></html>";
        let out = inject_script_nonces(html, "abc123");
        assert!(out.contains("<script nonce=\"abc123\">boot()</script>"));
        assert!(out.contains("<script nonce=\"abc123\" type=\"module\" src=\"/a.js\"></script>"));
    }

    #[test]
    fn csp_forbids_unsafe_inline_scripts_and_framing() {
        let csp = build_csp_header("deadbeef");
        assert!(csp.contains("script-src 'self' 'nonce-deadbeef'"));
        assert!(csp.contains("frame-ancestors 'none'"));
        assert!(!csp.contains("script-src 'self' 'unsafe-inline'"));
    }
}
