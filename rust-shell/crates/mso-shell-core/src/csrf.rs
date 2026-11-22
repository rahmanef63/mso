// CSRF depth-2 guard mirroring `crossOriginMutation` in root `proxy.ts`.
// Every mutating browser API call must prove same-origin intent in addition to
// SameSite=Strict session cookies.

pub fn is_mutating_method(method: &str) -> bool {
    matches!(method, "POST" | "PUT" | "PATCH" | "DELETE")
}

pub fn is_cross_origin_mutation(
    method: &str,
    sec_fetch_site: Option<&str>,
    origin: Option<&str>,
    host: Option<&str>,
    x_forwarded_host: Option<&str>,
    cookie: Option<&str>,
) -> bool {
    if !is_mutating_method(method) {
        return false;
    }
    if let Some(site) = sec_fetch_site.map(str::trim).filter(|s| !s.is_empty()) {
        return !matches!(site.to_ascii_lowercase().as_str(), "same-origin" | "none");
    }
    if let Some(orig) = origin.map(str::trim).filter(|s| !s.is_empty()) {
        let Some(expected_host) = x_forwarded_host
            .or(host)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            return true;
        };
        let Some(origin_host) = extract_origin_host_port(orig) else {
            return true;
        };
        return !origin_host.eq_ignore_ascii_case(expected_host);
    }
    !has_session_cookie(cookie)
}

fn extract_origin_host_port(origin: &str) -> Option<&str> {
    let (_, rest) = origin.split_once("://")?;
    if rest.is_empty() || rest.contains('@') || rest.contains('?') || rest.contains('#') {
        return None;
    }
    let authority = rest.split('/').next()?;
    if authority.is_empty() || authority.bytes().any(|b| b <= 0x20 || b == 0x7f) {
        return None;
    }
    Some(authority)
}

pub fn has_session_cookie(cookie_header: Option<&str>) -> bool {
    let Some(raw) = cookie_header else { return false };
    raw.split(';').any(|pair| {
        pair.trim()
            .split_once('=')
            .is_some_and(|(name, val)| name.trim() == "session" && !val.trim().is_empty())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_safe_methods_without_csrf_headers() {
        assert!(!is_cross_origin_mutation("GET", None, None, None, None, None));
        assert!(!is_cross_origin_mutation("HEAD", Some("cross-site"), None, None, None, None));
    }

    #[test]
    fn enforces_sec_fetch_site_authoritatively() {
        assert!(!is_cross_origin_mutation("POST", Some("same-origin"), None, None, None, None));
        assert!(!is_cross_origin_mutation("POST", Some("none"), None, None, None, None));
        assert!(is_cross_origin_mutation(
            "POST",
            Some("cross-site"),
            Some("http://127.0.0.1:4174"),
            Some("127.0.0.1:4174"),
            None,
            Some("session=tok")
        ));
        assert!(is_cross_origin_mutation("POST", Some("same-site"), None, None, None, Some("session=tok")));
    }

    #[test]
    fn checks_origin_host_when_sec_fetch_site_absent() {
        assert!(!is_cross_origin_mutation(
            "POST",
            None,
            Some("http://127.0.0.1:4174"),
            Some("127.0.0.1:4174"),
            None,
            None
        ));
        assert!(is_cross_origin_mutation(
            "POST",
            None,
            Some("https://evil.example"),
            Some("127.0.0.1:4174"),
            None,
            Some("session=tok")
        ));
        assert!(is_cross_origin_mutation(
            "POST",
            None,
            Some("not-a-url"),
            Some("127.0.0.1:4174"),
            None,
            None
        ));
    }

    #[test]
    fn requires_session_cookie_when_neither_sec_fetch_site_nor_origin_present() {
        assert!(!is_cross_origin_mutation("POST", None, None, Some("127.0.0.1:4174"), None, Some("a=1; session=abc")));
        assert!(is_cross_origin_mutation("POST", None, None, Some("127.0.0.1:4174"), None, None));
        assert!(is_cross_origin_mutation("POST", None, None, Some("127.0.0.1:4174"), None, Some("other=1")));
    }
}
