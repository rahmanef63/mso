use crate::managed::{is_blocked_managed_path, managed_app_proxy_target, MANAGED_APP_HOST_HEADER};
use crate::origin::HostOrigin;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const MAX_UPSTREAM_BYTES: usize = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(10);

pub const GLOBAL_MAX_BODY_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub struct RoutePolicy {
    pub path: &'static str,
    pub prefix: bool,
    pub methods: &'static [&'static str],
    pub max_body_bytes: usize,
    pub forward_authorization: bool,
}

const ROUTE_POLICIES: &[RoutePolicy] = &[
    // Auth & core cockpit APIs
    RoutePolicy { path: "/api/auth/me", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/auth/login", prefix: false, methods: &["POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/auth/logout", prefix: false, methods: &["POST"], max_body_bytes: 4 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/auth/devices", prefix: false, methods: &["GET", "POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/auth/password", prefix: false, methods: &["POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/auth/account", prefix: false, methods: &["GET", "POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/sys/stats", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    // Increment 3A host routes
    RoutePolicy { path: "/api/v1/sys/processes", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/list", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/read", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/write", prefix: false, methods: &["POST"], max_body_bytes: 512 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/mkdir", prefix: false, methods: &["POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/term/open", prefix: false, methods: &["POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/term/input", prefix: false, methods: &["POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/term/resize", prefix: false, methods: &["POST"], max_body_bytes: 4 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/term/close", prefix: false, methods: &["POST"], max_body_bytes: 4 * 1024, forward_authorization: false },
    // Increment 3B host routes
    RoutePolicy { path: "/api/v1/fs/delete", prefix: false, methods: &["DELETE"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/sys/services", prefix: false, methods: &["GET", "POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/sys/services/logs", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    // Wave 3 / Stage R3B cockpit routes
    RoutePolicy { path: "/api/prefs", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/models", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/threads", prefix: false, methods: &["GET", "POST", "PATCH", "DELETE"], max_body_bytes: 256 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/managed-apps", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/sys/packages", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    // Wave 3 / Stage R3C cockpit routes
    RoutePolicy { path: "/api/changelog", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/skills", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/memory", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/memory-graph", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/workflows", prefix: false, methods: &["GET", "POST"], max_body_bytes: 256 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/integrations", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/channels", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/organization", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    // Wave 3 / Stage R3D cockpit routes
    RoutePolicy { path: "/api/v1/app-catalog", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/features", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/sys/audit", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/infra/providers", prefix: false, methods: &["GET", "POST", "DELETE"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/agent-vault", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/agent-groups", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/agent-profiles", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/agent-sessions", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    // Wave 3 / Stage R3E cockpit routes
    RoutePolicy { path: "/api/v1/shell-apps", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/camoufox/service", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/camoufox/session", prefix: false, methods: &["GET", "POST", "DELETE"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/desktop/containers", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/desktop/lifecycle", prefix: false, methods: &["POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/raw", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/search", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/usage", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/stock/search", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/sys/update", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    // Wave 3 / Stage R3F cockpit routes
    RoutePolicy { path: "/api/v1/desktop/screenshot", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/copy", prefix: false, methods: &["POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/move", prefix: false, methods: &["POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    // Wave 3 / Stage R3G cockpit routes
    RoutePolicy { path: "/api/health", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/status", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/upload", prefix: false, methods: &["POST"], max_body_bytes: 4 * 1024 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/fs/zip", prefix: false, methods: &["POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    // Stage R2B machine protocol routes (CSRF-exempt, bearer-authenticated)
    RoutePolicy { path: "/mcp", prefix: false, methods: &["GET", "POST", "DELETE"], max_body_bytes: 1024 * 1024, forward_authorization: true },
    RoutePolicy { path: "/oauth/token", prefix: false, methods: &["POST"], max_body_bytes: 64 * 1024, forward_authorization: true },
    RoutePolicy { path: "/oauth/register", prefix: false, methods: &["POST"], max_body_bytes: 64 * 1024, forward_authorization: true },
    RoutePolicy { path: "/a2a/v1", prefix: false, methods: &["GET", "POST"], max_body_bytes: 1024 * 1024, forward_authorization: true },
    RoutePolicy { path: "/.well-known/agent-card.json", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: true },
    RoutePolicy { path: "/.well-known/oauth-", prefix: true, methods: &["GET"], max_body_bytes: 0, forward_authorization: true },
    RoutePolicy { path: "/api/assistant", prefix: false, methods: &["POST"], max_body_bytes: 640 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/term/stream", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/integrations/setup", prefix: false, methods: &["POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/mcp/activity", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/mcp/tokens", prefix: false, methods: &["GET", "POST", "DELETE"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/models/discover", prefix: false, methods: &["POST"], max_body_bytes: 8 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/models/providers", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/models/test", prefix: false, methods: &["POST"], max_body_bytes: 8 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/agent-profiles/run", prefix: false, methods: &["POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/agent-tools", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/alfa/cockpit", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/federation/status", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/infra/cloudflare/zones", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/infra/dokploy/projects", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/infra/providers/doctor", prefix: false, methods: &["POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/infra/setup", prefix: false, methods: &["POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/integrations/composio/session", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/integrations/transfer", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/managed-apps/discover", prefix: false, methods: &["GET"], max_body_bytes: 0, forward_authorization: false },
    RoutePolicy { path: "/api/v1/managed-apps/tunnels", prefix: false, methods: &["GET", "POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/skill-market", prefix: false, methods: &["GET", "POST"], max_body_bytes: 64 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/sys/cleanup", prefix: false, methods: &["GET", "POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/sys/memory-backup", prefix: false, methods: &["GET", "POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
    RoutePolicy { path: "/api/v1/sys/update/automation", prefix: false, methods: &["GET", "POST"], max_body_bytes: 16 * 1024, forward_authorization: false },
];

#[derive(Debug, Clone)]
pub struct ForwardRequest<'a> {
    pub method: &'a str,
    pub target: &'a str,
    pub host: Option<&'a str>,
    pub cookie: Option<&'a str>,
    pub authorization: Option<&'a str>,
    pub content_type: Option<&'a str>,
    pub accept: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub sec_fetch_site: Option<&'a str>,
    pub body: &'a [u8],
}

#[derive(Debug, Clone)]
pub struct ProxyResponse {
    pub status: u16,
    pub content_type: String,
    pub extra_headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
enum UpstreamMode<'a> {
    Api { forward_authorization: bool },
    ManagedApp(&'a str),
}

pub fn match_route_policy(target: &str) -> Option<RoutePolicy> {
    let path = target.split_once('?').map_or(target, |(p, _)| p);
    if path.contains("..") || path.contains('\\') {
        return None;
    }
    ROUTE_POLICIES.iter().copied().find(|p| {
        if p.prefix {
            path.starts_with(p.path)
        } else {
            p.path == path
        }
    })
}

pub fn forward_api_request(upstream: &HostOrigin, req: &ForwardRequest<'_>) -> ProxyResponse {
    let Some(policy) = match_route_policy(req.target) else {
        return json_error(404, "not_found");
    };
    if !policy.methods.contains(&req.method) {
        return ProxyResponse {
            status: 405,
            content_type: "application/json; charset=utf-8".into(),
            extra_headers: vec![("Allow".into(), policy.methods.join(", "))],
            body: br#"{"error":"method_not_allowed"}"#.to_vec(),
        };
    }
    if req.body.len() > policy.max_body_bytes {
        return json_error(413, "request_too_large");
    }
    forward_upstream(
        upstream,
        req.method,
        req.target,
        req,
        UpstreamMode::Api {
            forward_authorization: policy.forward_authorization,
        },
    )
}

pub fn forward_managed_app_request(
    upstream: &HostOrigin,
    app_id: &str,
    req: &ForwardRequest<'_>,
) -> ProxyResponse {
    if is_blocked_managed_path(req.target) {
        return ProxyResponse {
            status: 404,
            content_type: "text/plain; charset=utf-8".into(),
            extra_headers: Vec::new(),
            body: b"Not Found".to_vec(),
        };
    }
    if !matches!(req.method, "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS") {
        return json_error(405, "method_not_allowed");
    }
    if req.body.len() > GLOBAL_MAX_BODY_BYTES {
        return json_error(413, "request_too_large");
    }
    let rewritten = managed_app_proxy_target(app_id, req.target);
    forward_upstream(upstream, req.method, &rewritten, req, UpstreamMode::ManagedApp(app_id))
}

fn forward_upstream(
    upstream: &HostOrigin,
    method: &str,
    target: &str,
    req: &ForwardRequest<'_>,
    mode: UpstreamMode<'_>,
) -> ProxyResponse {
    if upstream.scheme != "http" {
        return json_error(501, "https_loopback_upstream_not_enabled");
    }
    if !target.starts_with('/') || target.contains('\r') || target.contains('\n') {
        return json_error(400, "bad_request");
    }

    let mut stream = match TcpStream::connect(upstream.socket_addr()) {
        Ok(s) => s,
        Err(_) => return json_error(502, "upstream_unavailable"),
    };
    let _ = stream.set_read_timeout(Some(UPSTREAM_TIMEOUT));
    let _ = stream.set_write_timeout(Some(UPSTREAM_TIMEOUT));

    let host_header = req
        .host
        .filter(|h| !h.contains('\r') && !h.contains('\n'))
        .unwrap_or(&upstream.host);
    let default_accept = match mode {
        UpstreamMode::Api { .. } => "application/json",
        UpstreamMode::ManagedApp(_) => "*/*",
    };
    let accept = req.accept.filter(|v| !v.is_empty()).unwrap_or(default_accept);

    let mut wire = format!("{method} {target} HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\n");
    push_header_if_safe(&mut wire, "Accept", Some(accept));
    push_header_if_safe(&mut wire, "Cookie", req.cookie);
    push_header_if_safe(&mut wire, "Origin", req.origin);
    push_header_if_safe(&mut wire, "Sec-Fetch-Site", req.sec_fetch_site);
    match mode {
        UpstreamMode::Api { forward_authorization: true } => {
            push_header_if_safe(&mut wire, "Authorization", req.authorization);
        }
        UpstreamMode::Api { forward_authorization: false } => {}
        UpstreamMode::ManagedApp(app_id) => {
            push_header_if_safe(&mut wire, MANAGED_APP_HOST_HEADER, Some(app_id));
        }
    }
    if !req.body.is_empty() {
        let ct = req.content_type.unwrap_or("application/json");
        push_header_if_safe(&mut wire, "Content-Type", Some(ct));
        wire.push_str(&format!("Content-Length: {}\r\n", req.body.len()));
    } else if matches!(method, "POST" | "PUT" | "PATCH") {
        wire.push_str("Content-Length: 0\r\n");
    }
    wire.push_str("\r\n");

    let mut out = wire.into_bytes();
    out.extend_from_slice(req.body);
    if stream.write_all(&out).is_err() {
        return json_error(502, "upstream_write_failed");
    }

    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if raw.len() + n > MAX_UPSTREAM_BYTES {
                    return json_error(502, "upstream_response_too_large");
                }
                raw.extend_from_slice(&buf[..n]);
            }
            Err(_) => return json_error(502, "upstream_read_failed"),
        }
    }
    parse_http_response(&raw, mode).unwrap_or_else(|| json_error(502, "upstream_malformed_response"))
}

fn push_header_if_safe(wire: &mut String, name: &str, value: Option<&str>) {
    if let Some(v) = value {
        if !v.is_empty() && !v.contains('\r') && !v.contains('\n') {
            wire.push_str(name);
            wire.push_str(": ");
            wire.push_str(v);
            wire.push_str("\r\n");
        }
    }
}

fn json_error(status: u16, code: &str) -> ProxyResponse {
    ProxyResponse {
        status,
        content_type: "application/json; charset=utf-8".into(),
        extra_headers: Vec::new(),
        body: format!(r#"{{"error":"{code}"}}"#).into_bytes(),
    }
}

fn parse_http_response(raw: &[u8], mode: UpstreamMode<'_>) -> Option<ProxyResponse> {
    let sep = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&raw[..sep]).ok()?;
    let body_raw = &raw[sep + 4..];

    let mut lines = head.split("\r\n");
    let status_line = lines.next()?;
    let mut parts = status_line.split_whitespace();
    if !parts.next()?.starts_with("HTTP/1.") {
        return None;
    }
    let status: u16 = parts.next()?.parse().ok()?;
    let mut content_type = "application/octet-stream".to_string();
    let mut extra_headers = Vec::new();
    let mut chunked = false;

    for line in lines {
        if let Some((name, val)) = line.split_once(':') {
            let key = name.trim().to_ascii_lowercase();
            let v = val.trim();
            match key.as_str() {
                "content-type" => content_type = v.to_string(),
                "set-cookie" => extra_headers.push(("Set-Cookie".into(), v.to_string())),
                "transfer-encoding" if v.to_ascii_lowercase().contains("chunked") => chunked = true,
                "mcp-session-id" | "www-authenticate"
                    if matches!(mode, UpstreamMode::Api { forward_authorization: true }) =>
                {
                    extra_headers.push((name.trim().to_string(), v.to_string()));
                }
                "location" | "cache-control" | "content-security-policy" | "etag"
                | "last-modified" | "vary"
                    if matches!(mode, UpstreamMode::ManagedApp(_)) =>
                {
                    extra_headers.push((name.trim().to_string(), v.to_string()));
                }
                _ => {}
            }
        }
    }
    let body = if chunked { decode_chunked(body_raw)? } else { body_raw.to_vec() };
    Some(ProxyResponse { status, content_type, extra_headers, body })
}

pub(crate) fn decode_chunked(mut input: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let crlf = input.windows(2).position(|w| w == b"\r\n")?;
        let size_str = std::str::from_utf8(&input[..crlf]).ok()?.split(';').next()?.trim();
        let size = usize::from_str_radix(size_str, 16).ok()?;
        input = &input[crlf + 2..];
        if size == 0 {
            return Some(out);
        }
        if input.len() < size + 2 || &input[size..size + 2] != b"\r\n" {
            return None;
        }
        out.extend_from_slice(&input[..size]);
        input = &input[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::parse_loopback_origin;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn forwards_post_login_body_and_preserves_multiple_set_cookie_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = conn.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]);
            assert!(req.starts_with("POST /api/auth/logout HTTP/1.1"));
            assert!(req.contains("Host: 127.0.0.1:4174"));
            assert!(req.contains("Cookie: session=abc"));
            assert!(!req.contains("Authorization:"));
            let resp = concat!(
                "HTTP/1.1 200 OK\r\n",
                "Content-Type: application/json\r\n",
                "Set-Cookie: session=; Max-Age=0; Path=/\r\n",
                "Set-Cookie: session=; Max-Age=0; Path=/; Domain=mso.example.com\r\n",
                "\r\n",
                r#"{"success":true}"#
            );
            conn.write_all(resp.as_bytes()).unwrap();
        });

        let origin = parse_loopback_origin(&format!("http://127.0.0.1:{port}")).unwrap();
        let bad = forward_api_request(&origin, &ForwardRequest {
            method: "DELETE", target: "/api/auth/devices", host: None, cookie: None,
            authorization: None, content_type: None, accept: None, origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(bad.status, 405);
        assert_eq!(forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/config", host: None, cookie: None,
            authorization: None, content_type: None, accept: None, origin: None, sec_fetch_site: None, body: &[],
        }).status, 404);

        let ok = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/auth/logout", host: Some("127.0.0.1:4174"),
            cookie: Some("session=abc"), authorization: Some("Bearer should-not-forward"),
            content_type: Some("application/json"), accept: None,
            origin: Some("http://127.0.0.1:4174"), sec_fetch_site: Some("same-origin"), body: &[],
        });
        assert_eq!(ok.status, 200);
        let cookies: Vec<&str> = ok.extra_headers.iter().filter(|(k, _)| k == "Set-Cookie").map(|(_, v)| v.as_str()).collect();
        assert_eq!(cookies.len(), 2);
        handle.join().unwrap();
    }

    #[test]
    fn matches_increment_3a_and_machine_protocol_routes_with_exact_limits() {
        assert_eq!(match_route_policy("/api/v1/sys/processes").unwrap().max_body_bytes, 0);
        assert_eq!(match_route_policy("/api/v1/fs/write").unwrap().max_body_bytes, 512 * 1024);
        assert_eq!(match_route_policy("/api/v1/term/input").unwrap().max_body_bytes, 64 * 1024);
        assert_eq!(match_route_policy("/api/v1/term/close").unwrap().max_body_bytes, 4 * 1024);
        assert!(match_route_policy("/mcp").unwrap().forward_authorization);
        assert!(match_route_policy("/.well-known/oauth-authorization-server").unwrap().forward_authorization);
        assert!(match_route_policy("/.well-known/agent-card.json").unwrap().forward_authorization);
        assert!(match_route_policy("/oauth/authorize").is_none());
        // Increment 3B host routes and unlisted exec/run guard
        let fs_del = match_route_policy("/api/v1/fs/delete").unwrap();
        assert_eq!(fs_del.methods, &["DELETE"]);
        assert_eq!(fs_del.max_body_bytes, 16 * 1024);
        assert!(!fs_del.forward_authorization);
        let sys_svc = match_route_policy("/api/v1/sys/services").unwrap();
        assert_eq!(sys_svc.methods, &["GET", "POST"]);
        assert_eq!(sys_svc.max_body_bytes, 16 * 1024);
        assert!(!sys_svc.forward_authorization);
        let sys_svc_logs = match_route_policy("/api/v1/sys/services/logs").unwrap();
        assert_eq!(sys_svc_logs.methods, &["GET"]);
        assert_eq!(sys_svc_logs.max_body_bytes, 0);
        assert!(!sys_svc_logs.forward_authorization);
        assert!(match_route_policy("/api/v1/exec/run").is_none());
        // Assistant chat and the terminal stream are real cockpit surfaces: the Svelte
        // client calls /api/assistant for SSE chat and /api/v1/term/stream for PTY output.
        // They were previously absent here, which 404'd both under mso-shell-host.
        let assistant = match_route_policy("/api/assistant").unwrap();
        assert_eq!(assistant.methods, &["POST"]);
        assert_eq!(assistant.max_body_bytes, 640 * 1024);
        assert!(!assistant.forward_authorization);
        let term_stream = match_route_policy("/api/v1/term/stream").unwrap();
        assert_eq!(term_stream.methods, &["GET"]);
        assert_eq!(term_stream.max_body_bytes, 0);
        assert!(!term_stream.forward_authorization);
        assert!(match_route_policy("/api/config").is_none());

        // Wave 3 / Stage R3B route policies
        let prefs = match_route_policy("/api/prefs").unwrap();
        assert_eq!(prefs.methods, &["GET", "POST"]);
        assert_eq!(prefs.max_body_bytes, 64 * 1024);
        assert!(!prefs.forward_authorization);

        let models = match_route_policy("/api/models").unwrap();
        assert_eq!(models.methods, &["GET"]);
        assert_eq!(models.max_body_bytes, 0);
        assert!(!models.forward_authorization);

        let threads = match_route_policy("/api/threads?id=t1").unwrap();
        assert_eq!(threads.methods, &["GET", "POST", "PATCH", "DELETE"]);
        assert_eq!(threads.max_body_bytes, 256 * 1024);
        assert!(!threads.forward_authorization);

        let managed_apps = match_route_policy("/api/v1/managed-apps").unwrap();
        assert_eq!(managed_apps.methods, &["GET"]);
        assert_eq!(managed_apps.max_body_bytes, 0);
        assert!(!managed_apps.forward_authorization);

        let packages = match_route_policy("/api/v1/sys/packages").unwrap();
        assert_eq!(packages.methods, &["GET"]);
        assert_eq!(packages.max_body_bytes, 0);
        assert!(!packages.forward_authorization);
    }

    #[test]
    fn forwards_machine_auth_and_managed_app_rewrite() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut c1, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = c1.read(&mut buf).unwrap();
            let req1 = String::from_utf8_lossy(&buf[..n]);
            assert!(req1.starts_with("POST /mcp HTTP/1.1"));
            assert!(req1.contains("Authorization: Bearer tok-123\r\n"));
            assert!(!req1.contains("x-os-managed-app-host"));
            c1.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}").unwrap();
            drop(c1);

            let (mut c2, _) = listener.accept().unwrap();
            let n2 = c2.read(&mut buf).unwrap();
            let req2 = String::from_utf8_lossy(&buf[..n2]);
            assert!(req2.starts_with("GET /api/v1/managed-apps/hermes/proxy/chat?x=1 HTTP/1.1"));
            assert!(req2.contains("x-os-managed-app-host: hermes\r\n"));
            assert!(!req2.contains("Authorization:"));
            c2.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<h1>app</h1>").unwrap();
        });

        let origin = parse_loopback_origin(&format!("http://127.0.0.1:{port}")).unwrap();
        let r1 = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/mcp", host: Some("mso.example.com"), cookie: None,
            authorization: Some("Bearer tok-123"), content_type: Some("application/json"),
            accept: Some("application/json"), origin: None, sec_fetch_site: None, body: b"{}",
        });
        assert_eq!(r1.status, 200);

        let blocked = forward_managed_app_request(&origin, "hermes", &ForwardRequest {
            method: "GET", target: "/_next/static/app.js", host: Some("hermes.mso.example.com"),
            cookie: None, authorization: None, content_type: None, accept: None, origin: None,
            sec_fetch_site: None, body: &[],
        });
        assert_eq!(blocked.status, 404);

        let r2 = forward_managed_app_request(&origin, "hermes", &ForwardRequest {
            method: "GET", target: "/chat/?x=1", host: Some("hermes.mso.example.com"),
            cookie: Some("session=abc"), authorization: Some("Bearer strip-me"), content_type: None,
            accept: Some("text/html"), origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(r2.status, 200);
        assert_eq!(r2.body, b"<h1>app</h1>");
        handle.join().unwrap();
    }

    #[test]
    fn matches_stage_r3c_routes_with_exact_limits_and_unlisted_guards() {
        let expected: &[(&str, &[&str], usize)] = &[
            ("/api/changelog", &["GET"], 0),
            ("/api/skills", &["GET"], 0),
            ("/api/memory", &["GET", "POST"], 65_536),
            ("/api/v1/memory-graph", &["GET"], 0),
            ("/api/v1/workflows", &["GET", "POST"], 262_144),
            ("/api/v1/integrations", &["GET", "POST"], 65_536),
            ("/api/v1/channels", &["GET", "POST"], 65_536),
            ("/api/v1/organization", &["GET", "POST"], 65_536),
        ];

        for &(path, methods, max_body) in expected {
            let p = match_route_policy(path).expect(path);
            assert!(!p.prefix, "expected exact match policy for {path}");
            assert_eq!(p.methods, methods, "methods mismatch for {path}");
            assert_eq!(p.max_body_bytes, max_body, "max_body_bytes mismatch for {path}");
            assert!(!p.forward_authorization, "must not forward Authorization on {path}");

            // Query strings still resolve the exact policy
            let with_q = format!("{path}?action=list&runs=1");
            assert_eq!(match_route_policy(&with_q).unwrap().path, path);

            // Subpaths must NOT match (exact-path matching only)
            let extra = format!("{path}/extra");
            assert!(match_route_policy(&extra).is_none(), "subpath should be unlisted: {extra}");
        }

        // Unlisted privileged routes must stay absent
        for unlisted in ["/api/config", "/api/v1/exec/run", "/api/v1/editor/exec"] {
            assert!(match_route_policy(unlisted).is_none(), "route must remain unlisted: {unlisted}");
            assert!(match_route_policy(&format!("{unlisted}?x=1")).is_none());
        }
    }

    #[test]
    fn forwards_stage_r3c_routes_and_enforces_method_limit_and_404_guards() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let cases: &[(&str, &str)] = &[
                ("GET /api/changelog?limit=10 HTTP/1.1", r#"{"entries":[]}"#),
                ("GET /api/v1/workflows?runs=1 HTTP/1.1", r#"{"runs":[]}"#),
                ("POST /api/v1/integrations?action=list HTTP/1.1", r#"{"ok":true}"#),
            ];
            for (expected_line, body) in cases {
                let (mut conn, _) = listener.accept().unwrap();
                let n = conn.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                assert!(req.starts_with(expected_line), "expected {expected_line}, got: {req}");
                assert!(req.contains("Host: mso.example.com\r\n"));
                assert!(req.contains("Cookie: session=r3c\r\n"));
                assert!(!req.contains("Authorization:"));
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{body}");
                conn.write_all(resp.as_bytes()).unwrap();
            }
        });

        let origin = parse_loopback_origin(&format!("http://127.0.0.1:{port}")).unwrap();

        // Unlisted routes return 404 without contacting upstream
        for unlisted in ["/api/config", "/api/v1/exec/run", "/api/v1/editor/exec"] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method: "POST", target: unlisted, host: Some("mso.example.com"),
                cookie: Some("session=r3c"), authorization: None, content_type: Some("application/json"),
                accept: None, origin: None, sec_fetch_site: Some("same-origin"), body: b"{}",
            });
            assert_eq!(r.status, 404, "expected 404 for {unlisted}");
        }

        // Disallowed methods return 405 without contacting upstream
        for (method, target, allow) in [
            ("POST", "/api/changelog", "GET"),
            ("POST", "/api/skills", "GET"),
            ("POST", "/api/v1/memory-graph", "GET"),
            ("DELETE", "/api/memory", "GET, POST"),
            ("DELETE", "/api/v1/workflows", "GET, POST"),
            ("DELETE", "/api/v1/integrations", "GET, POST"),
            ("DELETE", "/api/v1/channels", "GET, POST"),
            ("DELETE", "/api/v1/organization", "GET, POST"),
        ] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method, target, host: Some("mso.example.com"), cookie: None, authorization: None,
                content_type: None, accept: None, origin: None, sec_fetch_site: Some("same-origin"), body: &[],
            });
            assert_eq!(r.status, 405, "expected 405 for {method} {target}");
            assert!(r.extra_headers.iter().any(|(k, v)| k == "Allow" && v == allow));
        }

        // Body limit enforcement (413) without contacting upstream
        let over_64k = vec![b'x'; 65_537];
        for target in ["/api/memory", "/api/v1/integrations", "/api/v1/channels", "/api/v1/organization"] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method: "POST", target, host: Some("mso.example.com"), cookie: None, authorization: None,
                content_type: Some("application/json"), accept: None, origin: None,
                sec_fetch_site: Some("same-origin"), body: &over_64k,
            });
            assert_eq!(r.status, 413, "expected 413 for {target}");
        }
        let over_256k = vec![b'x'; 262_145];
        let r_wf_big = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/v1/workflows", host: Some("mso.example.com"), cookie: None,
            authorization: None, content_type: Some("application/json"), accept: None, origin: None,
            sec_fetch_site: Some("same-origin"), body: &over_256k,
        });
        assert_eq!(r_wf_big.status, 413);

        // Allowed requests forward query strings, Host, Cookie and strip Authorization
        let r_ch = forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/changelog?limit=10", host: Some("mso.example.com"),
            cookie: Some("session=r3c"), authorization: Some("Bearer strip-me"),
            content_type: None, accept: None, origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(r_ch.status, 200);
        assert_eq!(r_ch.body, br#"{"entries":[]}"#);

        let r_wf = forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/v1/workflows?runs=1", host: Some("mso.example.com"),
            cookie: Some("session=r3c"), authorization: Some("Bearer strip-me"),
            content_type: None, accept: None, origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(r_wf.status, 200);
        assert_eq!(r_wf.body, br#"{"runs":[]}"#);

        let r_int = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/v1/integrations?action=list", host: Some("mso.example.com"),
            cookie: Some("session=r3c"), authorization: Some("Bearer strip-me"),
            content_type: Some("application/json"), accept: None, origin: Some("http://mso.example.com"),
            sec_fetch_site: Some("same-origin"), body: br#"{"action":"list"}"#,
        });
        assert_eq!(r_int.status, 200);
        assert_eq!(r_int.body, br#"{"ok":true}"#);

        handle.join().unwrap();
    }

    #[test]
    fn matches_stage_r3d_routes_with_exact_limits_and_unlisted_guards() {
        let expected: &[(&str, &[&str], usize)] = &[
            ("/api/v1/app-catalog", &["GET"], 0),
            ("/api/v1/features", &["GET"], 0),
            ("/api/v1/sys/audit", &["GET"], 0),
            ("/api/v1/infra/providers", &["GET", "POST", "DELETE"], 65_536),
            ("/api/v1/agent-vault", &["GET", "POST"], 65_536),
            ("/api/v1/agent-groups", &["GET", "POST"], 65_536),
            ("/api/v1/agent-profiles", &["GET", "POST"], 65_536),
            ("/api/v1/agent-sessions", &["GET", "POST"], 65_536),
        ];

        for &(path, methods, max_body) in expected {
            let p = match_route_policy(path).expect(path);
            assert!(!p.prefix, "expected exact match policy for {path}");
            assert_eq!(p.methods, methods, "methods mismatch for {path}");
            assert_eq!(p.max_body_bytes, max_body, "max_body_bytes mismatch for {path}");
            assert!(!p.forward_authorization, "must not forward Authorization on {path}");

            // Query strings still resolve the exact policy
            let with_q = format!("{path}?action=list&providerId=cloudflare");
            assert_eq!(match_route_policy(&with_q).unwrap().path, path);

            // Subpaths must NOT match (exact-path matching only)
            let extra = format!("{path}/extra");
            assert!(match_route_policy(&extra).is_none(), "subpath should be unlisted: {extra}");
        }

        // Unlisted privileged routes must stay absent
        for unlisted in ["/api/config", "/api/v1/exec/run", "/api/v1/editor/exec"] {
            assert!(match_route_policy(unlisted).is_none(), "route must remain unlisted: {unlisted}");
            assert!(match_route_policy(&format!("{unlisted}?x=1")).is_none());
        }
    }

    #[test]
    fn forwards_stage_r3d_routes_and_enforces_method_limit_and_404_guards() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let cases: &[(&str, &str)] = &[
                ("GET /api/v1/app-catalog?category=all HTTP/1.1", r#"{"apps":[]}"#),
                ("DELETE /api/v1/infra/providers?providerId=cloudflare HTTP/1.1", r#"{"deleted":true}"#),
                ("POST /api/v1/agent-sessions?action=create HTTP/1.1", r#"{"sessionId":"s-1"}"#),
            ];
            for (expected_line, body) in cases {
                let (mut conn, _) = listener.accept().unwrap();
                let n = conn.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                assert!(req.starts_with(expected_line), "expected {expected_line}, got: {req}");
                assert!(req.contains("Host: mso.example.com\r\n"));
                assert!(req.contains("Cookie: session=r3d\r\n"));
                assert!(!req.contains("Authorization:"));
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{body}");
                conn.write_all(resp.as_bytes()).unwrap();
            }
        });

        let origin = parse_loopback_origin(&format!("http://127.0.0.1:{port}")).unwrap();

        // Disallowed methods return 405 without contacting upstream
        for (method, target, allow) in [
            ("POST", "/api/v1/app-catalog", "GET"),
            ("POST", "/api/v1/features", "GET"),
            ("POST", "/api/v1/sys/audit", "GET"),
            ("PATCH", "/api/v1/infra/providers", "GET, POST, DELETE"),
            ("DELETE", "/api/v1/agent-vault", "GET, POST"),
            ("DELETE", "/api/v1/agent-groups", "GET, POST"),
            ("DELETE", "/api/v1/agent-profiles", "GET, POST"),
            ("DELETE", "/api/v1/agent-sessions", "GET, POST"),
        ] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method, target, host: Some("mso.example.com"), cookie: None, authorization: None,
                content_type: None, accept: None, origin: None, sec_fetch_site: Some("same-origin"), body: &[],
            });
            assert_eq!(r.status, 405, "expected 405 for {method} {target}");
            assert!(r.extra_headers.iter().any(|(k, v)| k == "Allow" && v == allow));
        }

        // Body limit enforcement (413) without contacting upstream
        let over_64k = vec![b'x'; 65_537];
        for (method, target) in [
            ("POST", "/api/v1/infra/providers"),
            ("DELETE", "/api/v1/infra/providers"),
            ("POST", "/api/v1/agent-vault"),
            ("POST", "/api/v1/agent-groups"),
            ("POST", "/api/v1/agent-profiles"),
            ("POST", "/api/v1/agent-sessions"),
        ] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method, target, host: Some("mso.example.com"), cookie: None, authorization: None,
                content_type: Some("application/json"), accept: None, origin: None,
                sec_fetch_site: Some("same-origin"), body: &over_64k,
            });
            assert_eq!(r.status, 413, "expected 413 for {method} {target}");
        }

        // Allowed requests forward query strings, Host, Cookie and strip Authorization
        let r_cat = forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/v1/app-catalog?category=all", host: Some("mso.example.com"),
            cookie: Some("session=r3d"), authorization: Some("Bearer strip-me"),
            content_type: None, accept: None, origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(r_cat.status, 200);
        assert_eq!(r_cat.body, br#"{"apps":[]}"#);

        let r_prov = forward_api_request(&origin, &ForwardRequest {
            method: "DELETE", target: "/api/v1/infra/providers?providerId=cloudflare", host: Some("mso.example.com"),
            cookie: Some("session=r3d"), authorization: Some("Bearer strip-me"),
            content_type: Some("application/json"), accept: None, origin: Some("http://mso.example.com"),
            sec_fetch_site: Some("same-origin"), body: br#"{"providerId":"cloudflare"}"#,
        });
        assert_eq!(r_prov.status, 200);
        assert_eq!(r_prov.body, br#"{"deleted":true}"#);

        let r_sess = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/v1/agent-sessions?action=create", host: Some("mso.example.com"),
            cookie: Some("session=r3d"), authorization: Some("Bearer strip-me"),
            content_type: Some("application/json"), accept: None, origin: Some("http://mso.example.com"),
            sec_fetch_site: Some("same-origin"), body: br#"{"title":"New Session"}"#,
        });
        assert_eq!(r_sess.status, 200);
        assert_eq!(r_sess.body, br#"{"sessionId":"s-1"}"#);

        handle.join().unwrap();
    }

    #[test]
    fn matches_stage_r3e_routes_with_exact_limits_and_unlisted_guards() {
        let expected: &[(&str, &[&str], usize)] = &[
            ("/api/v1/shell-apps", &["GET", "POST"], 65_536),
            ("/api/v1/camoufox/service", &["GET", "POST"], 65_536),
            ("/api/v1/camoufox/session", &["GET", "POST", "DELETE"], 65_536),
            ("/api/v1/desktop/containers", &["GET", "POST"], 65_536),
            ("/api/v1/desktop/lifecycle", &["POST"], 65_536),
            ("/api/v1/fs/raw", &["GET"], 0),
            ("/api/v1/fs/search", &["GET"], 0),
            ("/api/v1/fs/usage", &["GET"], 0),
            ("/api/v1/stock/search", &["GET"], 0),
            ("/api/v1/sys/update", &["GET"], 0),
        ];

        for &(path, methods, max_body) in expected {
            let p = match_route_policy(path).expect(path);
            assert!(!p.prefix, "expected exact match policy for {path}");
            assert_eq!(p.methods, methods, "methods mismatch for {path}");
            assert_eq!(p.max_body_bytes, max_body, "max_body_bytes mismatch for {path}");
            assert!(!p.forward_authorization, "must not forward Authorization on {path}");

            // Query strings still resolve the exact policy
            let with_q = format!("{path}?q=test&id=1");
            assert_eq!(match_route_policy(&with_q).unwrap().path, path);

            // Subpaths must NOT match (exact-path matching only)
            let extra = format!("{path}/extra");
            assert!(match_route_policy(&extra).is_none(), "subpath should be unlisted: {extra}");
        }

        // Unlisted privileged routes must stay absent
        for unlisted in ["/api/config", "/api/v1/exec/run", "/api/v1/editor/exec"] {
            assert!(match_route_policy(unlisted).is_none(), "route must remain unlisted: {unlisted}");
            assert!(match_route_policy(&format!("{unlisted}?x=1")).is_none());
        }
    }

    #[test]
    fn forwards_stage_r3e_routes_and_enforces_method_limit_and_404_guards() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let cases: &[(&str, &str)] = &[
                ("DELETE /api/v1/camoufox/session?id=cf-1 HTTP/1.1", r#"{"closed":true}"#),
                ("POST /api/v1/desktop/lifecycle HTTP/1.1", r#"{"state":"started"}"#),
                ("GET /api/v1/fs/raw?path=notes.txt HTTP/1.1", r#"{"raw":"ok"}"#),
                ("GET /api/v1/sys/update HTTP/1.1", r#"{"upToDate":true}"#),
            ];
            for (expected_line, body) in cases {
                let (mut conn, _) = listener.accept().unwrap();
                let n = conn.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                assert!(req.starts_with(expected_line), "expected {expected_line}, got: {req}");
                assert!(req.contains("Host: mso.example.com\r\n"));
                assert!(req.contains("Cookie: session=r3e\r\n"));
                assert!(!req.contains("Authorization:"));
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{body}");
                conn.write_all(resp.as_bytes()).unwrap();
            }
        });

        let origin = parse_loopback_origin(&format!("http://127.0.0.1:{port}")).unwrap();

        // Disallowed methods return 405 without contacting upstream
        for (method, target, allow) in [
            ("DELETE", "/api/v1/shell-apps", "GET, POST"),
            ("DELETE", "/api/v1/camoufox/service", "GET, POST"),
            ("PATCH", "/api/v1/camoufox/session", "GET, POST, DELETE"),
            ("DELETE", "/api/v1/desktop/containers", "GET, POST"),
            ("GET", "/api/v1/desktop/lifecycle", "POST"),
            ("DELETE", "/api/v1/desktop/lifecycle", "POST"),
            ("POST", "/api/v1/fs/raw", "GET"),
            ("POST", "/api/v1/fs/search", "GET"),
            ("POST", "/api/v1/fs/usage", "GET"),
            ("POST", "/api/v1/stock/search", "GET"),
            ("POST", "/api/v1/sys/update", "GET"),
        ] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method, target, host: Some("mso.example.com"), cookie: None, authorization: None,
                content_type: None, accept: None, origin: None, sec_fetch_site: Some("same-origin"), body: &[],
            });
            assert_eq!(r.status, 405, "expected 405 for {method} {target}");
            assert!(r.extra_headers.iter().any(|(k, v)| k == "Allow" && v == allow));
        }

        // Body limit enforcement (413) without contacting upstream
        let over_64k = vec![b'x'; 65_537];
        for (method, target) in [
            ("POST", "/api/v1/shell-apps"),
            ("POST", "/api/v1/camoufox/service"),
            ("POST", "/api/v1/camoufox/session"),
            ("DELETE", "/api/v1/camoufox/session"),
            ("POST", "/api/v1/desktop/containers"),
            ("POST", "/api/v1/desktop/lifecycle"),
        ] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method, target, host: Some("mso.example.com"), cookie: None, authorization: None,
                content_type: Some("application/json"), accept: None, origin: None,
                sec_fetch_site: Some("same-origin"), body: &over_64k,
            });
            assert_eq!(r.status, 413, "expected 413 for {method} {target}");
        }

        // Allowed requests forward query strings, Host, Cookie and strip Authorization
        let r_cf = forward_api_request(&origin, &ForwardRequest {
            method: "DELETE", target: "/api/v1/camoufox/session?id=cf-1", host: Some("mso.example.com"),
            cookie: Some("session=r3e"), authorization: Some("Bearer strip-me"),
            content_type: Some("application/json"), accept: None, origin: Some("http://mso.example.com"),
            sec_fetch_site: Some("same-origin"), body: br#"{"id":"cf-1"}"#,
        });
        assert_eq!(r_cf.status, 200);
        assert_eq!(r_cf.body, br#"{"closed":true}"#);

        let r_lc = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/v1/desktop/lifecycle", host: Some("mso.example.com"),
            cookie: Some("session=r3e"), authorization: Some("Bearer strip-me"),
            content_type: Some("application/json"), accept: None, origin: Some("http://mso.example.com"),
            sec_fetch_site: Some("same-origin"), body: br#"{"action":"start"}"#,
        });
        assert_eq!(r_lc.status, 200);
        assert_eq!(r_lc.body, br#"{"state":"started"}"#);

        let r_raw = forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/v1/fs/raw?path=notes.txt", host: Some("mso.example.com"),
            cookie: Some("session=r3e"), authorization: Some("Bearer strip-me"),
            content_type: None, accept: None, origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(r_raw.status, 200);
        assert_eq!(r_raw.body, br#"{"raw":"ok"}"#);

        let r_upd = forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/v1/sys/update", host: Some("mso.example.com"),
            cookie: Some("session=r3e"), authorization: Some("Bearer strip-me"),
            content_type: None, accept: None, origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(r_upd.status, 200);
        assert_eq!(r_upd.body, br#"{"upToDate":true}"#);

        handle.join().unwrap();
    }

    #[test]
    fn matches_stage_r3f_routes_with_exact_limits_and_unlisted_guards() {
        let expected: &[(&str, &[&str], usize)] = &[
            ("/api/v1/desktop/screenshot", &["GET"], 0),
            ("/api/v1/fs/copy", &["POST"], 65_536),
            ("/api/v1/fs/move", &["POST"], 65_536),
        ];

        for &(path, methods, max_body) in expected {
            let p = match_route_policy(path).expect(path);
            assert!(!p.prefix, "expected exact match policy for {path}");
            assert_eq!(p.methods, methods, "methods mismatch for {path}");
            assert_eq!(p.max_body_bytes, max_body, "max_body_bytes mismatch for {path}");
            assert!(!p.forward_authorization, "must not forward Authorization on {path}");

            let with_q = format!("{path}?id=1&from=a");
            assert_eq!(match_route_policy(&with_q).unwrap().path, path);

            let extra = format!("{path}/extra");
            assert!(match_route_policy(&extra).is_none(), "subpath should be unlisted: {extra}");
        }

        for unlisted in ["/api/config", "/api/v1/exec/run", "/api/v1/editor/exec"] {
            assert!(match_route_policy(unlisted).is_none(), "route must remain unlisted: {unlisted}");
            assert!(match_route_policy(&format!("{unlisted}?x=1")).is_none());
        }
    }

    #[test]
    fn forwards_stage_r3f_routes_and_enforces_method_limit_and_404_guards() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let cases: &[(&str, &str)] = &[
                ("GET /api/v1/desktop/screenshot?id=dc-1 HTTP/1.1", r#"{"image":"ok"}"#),
                ("POST /api/v1/fs/copy HTTP/1.1", r#"{"copied":true}"#),
                ("POST /api/v1/fs/move HTTP/1.1", r#"{"moved":true}"#),
            ];
            for (expected_line, body) in cases {
                let (mut conn, _) = listener.accept().unwrap();
                let n = conn.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                assert!(req.starts_with(expected_line), "expected {expected_line}, got: {req}");
                assert!(req.contains("Host: mso.example.com\r\n"));
                assert!(req.contains("Cookie: session=r3f\r\n"));
                assert!(!req.contains("Authorization:"));
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{body}");
                conn.write_all(resp.as_bytes()).unwrap();
            }
        });

        let origin = parse_loopback_origin(&format!("http://127.0.0.1:{port}")).unwrap();

        // Unlisted routes return 404 without contacting upstream
        for unlisted in ["/api/config", "/api/v1/exec/run", "/api/v1/editor/exec"] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method: "POST", target: unlisted, host: Some("mso.example.com"),
                cookie: Some("session=r3f"), authorization: None, content_type: Some("application/json"),
                accept: None, origin: None, sec_fetch_site: Some("same-origin"), body: b"{}",
            });
            assert_eq!(r.status, 404, "expected 404 for {unlisted}");
        }

        // Disallowed methods return 405 without contacting upstream
        for (method, target, allow) in [
            ("POST", "/api/v1/desktop/screenshot", "GET"),
            ("DELETE", "/api/v1/desktop/screenshot", "GET"),
            ("GET", "/api/v1/fs/copy", "POST"),
            ("DELETE", "/api/v1/fs/copy", "POST"),
            ("GET", "/api/v1/fs/move", "POST"),
            ("DELETE", "/api/v1/fs/move", "POST"),
        ] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method, target, host: Some("mso.example.com"), cookie: None, authorization: None,
                content_type: None, accept: None, origin: None, sec_fetch_site: Some("same-origin"), body: &[],
            });
            assert_eq!(r.status, 405, "expected 405 for {method} {target}");
            assert!(r.extra_headers.iter().any(|(k, v)| k == "Allow" && v == allow));
        }

        // Body limit enforcement (413) without contacting upstream
        let over_64k = vec![b'x'; 65_537];
        for target in ["/api/v1/fs/copy", "/api/v1/fs/move"] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method: "POST", target, host: Some("mso.example.com"), cookie: None, authorization: None,
                content_type: Some("application/json"), accept: None, origin: None,
                sec_fetch_site: Some("same-origin"), body: &over_64k,
            });
            assert_eq!(r.status, 413, "expected 413 for {target}");
        }
        let r_ss_body = forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/v1/desktop/screenshot", host: Some("mso.example.com"),
            cookie: None, authorization: None, content_type: None, accept: None, origin: None,
            sec_fetch_site: None, body: b"x",
        });
        assert_eq!(r_ss_body.status, 413);

        // Allowed requests forward query strings, Host, Cookie and strip Authorization
        let r_ss = forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/v1/desktop/screenshot?id=dc-1", host: Some("mso.example.com"),
            cookie: Some("session=r3f"), authorization: Some("Bearer strip-me"),
            content_type: None, accept: None, origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(r_ss.status, 200);
        assert_eq!(r_ss.body, br#"{"image":"ok"}"#);

        let r_cp = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/v1/fs/copy", host: Some("mso.example.com"),
            cookie: Some("session=r3f"), authorization: Some("Bearer strip-me"),
            content_type: Some("application/json"), accept: None, origin: Some("http://mso.example.com"),
            sec_fetch_site: Some("same-origin"), body: br#"{"src":"a.txt","dst":"b.txt"}"#,
        });
        assert_eq!(r_cp.status, 200);
        assert_eq!(r_cp.body, br#"{"copied":true}"#);

        let r_mv = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/v1/fs/move", host: Some("mso.example.com"),
            cookie: Some("session=r3f"), authorization: Some("Bearer strip-me"),
            content_type: Some("application/json"), accept: None, origin: Some("http://mso.example.com"),
            sec_fetch_site: Some("same-origin"), body: br#"{"src":"a.txt","dst":"c.txt"}"#,
        });
        assert_eq!(r_mv.status, 200);
        assert_eq!(r_mv.body, br#"{"moved":true}"#);

        handle.join().unwrap();
    }

    #[test]
    fn matches_auth_password_and_account_routes_with_exact_limits() {
        let pw = match_route_policy("/api/auth/password").expect("/api/auth/password");
        assert!(!pw.prefix);
        assert_eq!(pw.methods, &["POST"]);
        assert_eq!(pw.max_body_bytes, 16 * 1024);
        assert!(!pw.forward_authorization);
        assert!(match_route_policy("/api/auth/password/extra").is_none());

        let acct = match_route_policy("/api/auth/account").expect("/api/auth/account");
        assert!(!acct.prefix);
        assert_eq!(acct.methods, &["GET", "POST"]);
        assert_eq!(acct.max_body_bytes, 16 * 1024);
        assert!(!acct.forward_authorization);
        assert!(match_route_policy("/api/auth/account/extra").is_none());
    }

    #[test]
    fn matches_stage_r3g_routes_with_exact_limits_and_unlisted_guards() {
        let expected: &[(&str, &[&str], usize)] = &[
            ("/api/health", &["GET"], 0),
            ("/api/status", &["GET"], 0),
            ("/api/v1/fs/upload", &["POST"], 4 * 1024 * 1024),
            ("/api/v1/fs/zip", &["POST"], 64 * 1024),
        ];

        for &(path, methods, max_body) in expected {
            let p = match_route_policy(path).expect(path);
            assert!(!p.prefix, "expected exact match policy for {path}");
            assert_eq!(p.methods, methods, "methods mismatch for {path}");
            assert_eq!(p.max_body_bytes, max_body, "max_body_bytes mismatch for {path}");
            assert!(!p.forward_authorization, "must not forward Authorization on {path}");

            let with_q = format!("{path}?dest=notes&mode=1");
            assert_eq!(match_route_policy(&with_q).unwrap().path, path);

            let extra = format!("{path}/extra");
            assert!(match_route_policy(&extra).is_none(), "subpath should be unlisted: {extra}");
        }

        for unlisted in ["/api/config", "/api/v1/exec/run", "/api/v1/editor/exec"] {
            assert!(match_route_policy(unlisted).is_none(), "route must remain unlisted: {unlisted}");
            assert!(match_route_policy(&format!("{unlisted}?x=1")).is_none());
        }
    }

    #[test]
    fn forwards_stage_r3g_routes_and_enforces_method_limit_and_404_guards() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let cases: &[(&str, &str)] = &[
                ("GET /api/health HTTP/1.1", r#"{"ok":true}"#),
                ("GET /api/status?verbose=1 HTTP/1.1", r#"{"status":"ready"}"#),
                ("POST /api/v1/fs/upload?dest=notes HTTP/1.1", r#"{"written":1}"#),
                ("POST /api/v1/fs/zip HTTP/1.1", r#"{"zipped":true}"#),
            ];
            for (expected_line, body) in cases {
                let (mut conn, _) = listener.accept().unwrap();
                let n = conn.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                assert!(req.starts_with(expected_line), "expected {expected_line}, got: {req}");
                assert!(req.contains("Host: mso.example.com\r\n"));
                assert!(req.contains("Cookie: session=r3g\r\n"));
                assert!(!req.contains("Authorization:"));
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{body}");
                conn.write_all(resp.as_bytes()).unwrap();
            }
        });

        let origin = parse_loopback_origin(&format!("http://127.0.0.1:{port}")).unwrap();

        // Unlisted routes return 404 without contacting upstream
        for unlisted in ["/api/config", "/api/v1/exec/run", "/api/v1/editor/exec"] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method: "POST", target: unlisted, host: Some("mso.example.com"),
                cookie: Some("session=r3g"), authorization: None, content_type: Some("application/json"),
                accept: None, origin: None, sec_fetch_site: Some("same-origin"), body: b"{}",
            });
            assert_eq!(r.status, 404, "expected 404 for {unlisted}");
        }

        // Disallowed methods return 405 without contacting upstream
        for (method, target, allow) in [
            ("POST", "/api/health", "GET"),
            ("DELETE", "/api/health", "GET"),
            ("POST", "/api/status", "GET"),
            ("DELETE", "/api/status", "GET"),
            ("GET", "/api/v1/fs/upload", "POST"),
            ("DELETE", "/api/v1/fs/upload", "POST"),
            ("GET", "/api/v1/fs/zip", "POST"),
            ("DELETE", "/api/v1/fs/zip", "POST"),
        ] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method, target, host: Some("mso.example.com"), cookie: None, authorization: None,
                content_type: None, accept: None, origin: None, sec_fetch_site: Some("same-origin"), body: &[],
            });
            assert_eq!(r.status, 405, "expected 405 for {method} {target}");
            assert!(r.extra_headers.iter().any(|(k, v)| k == "Allow" && v == allow));
        }

        // Body limit enforcement (413) without contacting upstream
        for target in ["/api/health", "/api/status"] {
            let r = forward_api_request(&origin, &ForwardRequest {
                method: "GET", target, host: Some("mso.example.com"), cookie: None, authorization: None,
                content_type: None, accept: None, origin: None, sec_fetch_site: None, body: b"x",
            });
            assert_eq!(r.status, 413, "expected 413 for {target}");
        }
        let over_64k = vec![b'z'; 64 * 1024 + 1];
        let r_zip_big = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/v1/fs/zip", host: Some("mso.example.com"), cookie: None,
            authorization: None, content_type: Some("application/json"), accept: None, origin: None,
            sec_fetch_site: Some("same-origin"), body: &over_64k,
        });
        assert_eq!(r_zip_big.status, 413);

        let over_4m = vec![b'u'; 4 * 1024 * 1024 + 1];
        let r_up_big = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/v1/fs/upload", host: Some("mso.example.com"), cookie: None,
            authorization: None, content_type: Some("multipart/form-data"), accept: None, origin: None,
            sec_fetch_site: Some("same-origin"), body: &over_4m,
        });
        assert_eq!(r_up_big.status, 413);

        // Allowed requests forward query strings, Host, Cookie and strip Authorization
        let r_health = forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/health", host: Some("mso.example.com"),
            cookie: Some("session=r3g"), authorization: Some("Bearer strip-me"),
            content_type: None, accept: None, origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(r_health.status, 200);
        assert_eq!(r_health.body, br#"{"ok":true}"#);

        let r_status = forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/status?verbose=1", host: Some("mso.example.com"),
            cookie: Some("session=r3g"), authorization: Some("Bearer strip-me"),
            content_type: None, accept: None, origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(r_status.status, 200);
        assert_eq!(r_status.body, br#"{"status":"ready"}"#);

        let r_upload = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/v1/fs/upload?dest=notes", host: Some("mso.example.com"),
            cookie: Some("session=r3g"), authorization: Some("Bearer strip-me"),
            content_type: Some("multipart/form-data; boundary=abc"), accept: None,
            origin: Some("http://mso.example.com"), sec_fetch_site: Some("same-origin"),
            body: b"--abc--\r\n",
        });
        assert_eq!(r_upload.status, 200);
        assert_eq!(r_upload.body, br#"{"written":1}"#);

        let r_zip = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/v1/fs/zip", host: Some("mso.example.com"),
            cookie: Some("session=r3g"), authorization: Some("Bearer strip-me"),
            content_type: Some("application/json"), accept: None,
            origin: Some("http://mso.example.com"), sec_fetch_site: Some("same-origin"),
            body: br#"{"paths":["notes"]}"#,
        });
        assert_eq!(r_zip.status, 200);
        assert_eq!(r_zip.body, br#"{"zipped":true}"#);

        handle.join().unwrap();
    }
}
