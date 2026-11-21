use crate::origin::HostOrigin;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const MAX_UPSTREAM_BYTES: usize = 1_048_576;
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy)]
pub struct RoutePolicy {
    pub path: &'static str,
    pub methods: &'static [&'static str],
    pub max_body_bytes: usize,
}

const ROUTE_POLICIES: &[RoutePolicy] = &[
    RoutePolicy { path: "/api/auth/me", methods: &["GET"], max_body_bytes: 0 },
    RoutePolicy { path: "/api/auth/login", methods: &["POST"], max_body_bytes: 16 * 1024 },
    RoutePolicy { path: "/api/auth/logout", methods: &["POST"], max_body_bytes: 4 * 1024 },
    RoutePolicy { path: "/api/auth/devices", methods: &["GET", "POST"], max_body_bytes: 16 * 1024 },
    RoutePolicy { path: "/api/v1/sys/stats", methods: &["GET"], max_body_bytes: 0 },
];

pub const GLOBAL_MAX_BODY_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone)]
pub struct ForwardRequest<'a> {
    pub method: &'a str,
    pub target: &'a str,
    pub host: Option<&'a str>,
    pub cookie: Option<&'a str>,
    pub content_type: Option<&'a str>,
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

pub fn match_route_policy(target: &str) -> Option<RoutePolicy> {
    let path = target.split_once('?').map_or(target, |(p, _)| p);
    ROUTE_POLICIES.iter().copied().find(|p| p.path == path)
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
    if upstream.scheme != "http" {
        return json_error(501, "https_loopback_upstream_not_enabled");
    }

    let mut stream = match TcpStream::connect(upstream.socket_addr()) {
        Ok(s) => s,
        Err(_) => return json_error(502, "upstream_unavailable"),
    };
    let _ = stream.set_read_timeout(Some(UPSTREAM_TIMEOUT));
    let _ = stream.set_write_timeout(Some(UPSTREAM_TIMEOUT));

    let host_header = req.host.unwrap_or(&upstream.host);
    let mut wire = format!(
        "{} {} HTTP/1.1\r\nHost: {host_header}\r\nAccept: application/json\r\nConnection: close\r\n",
        req.method, req.target
    );
    push_header_if_safe(&mut wire, "Cookie", req.cookie);
    push_header_if_safe(&mut wire, "Origin", req.origin);
    push_header_if_safe(&mut wire, "Sec-Fetch-Site", req.sec_fetch_site);
    if !req.body.is_empty() {
        let ct = req.content_type.unwrap_or("application/json");
        push_header_if_safe(&mut wire, "Content-Type", Some(ct));
        wire.push_str(&format!("Content-Length: {}\r\n", req.body.len()));
    } else if req.method == "POST" {
        wire.push_str("Content-Length: 0\r\n");
    }
    wire.push_str("\r\n");

    if stream.write_all(wire.as_bytes()).is_err()
        || (!req.body.is_empty() && stream.write_all(req.body).is_err())
    {
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
    parse_http_response(&raw).unwrap_or_else(|| json_error(502, "upstream_malformed_response"))
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

fn parse_http_response(raw: &[u8]) -> Option<ProxyResponse> {
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
            if key == "content-type" {
                content_type = v.to_string();
            } else if key == "set-cookie" {
                extra_headers.push(("Set-Cookie".into(), v.to_string()));
            } else if key == "transfer-encoding" && v.to_ascii_lowercase().contains("chunked") {
                chunked = true;
            }
        }
    }
    let body = if chunked { decode_chunked(body_raw)? } else { body_raw.to_vec() };
    Some(ProxyResponse { status, content_type, extra_headers, body })
}

fn decode_chunked(mut input: &[u8]) -> Option<Vec<u8>> {
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
            content_type: None, origin: None, sec_fetch_site: None, body: &[],
        });
        assert_eq!(bad.status, 405);
        assert_eq!(forward_api_request(&origin, &ForwardRequest {
            method: "GET", target: "/api/config", host: None, cookie: None,
            content_type: None, origin: None, sec_fetch_site: None, body: &[],
        }).status, 404);

        let ok = forward_api_request(&origin, &ForwardRequest {
            method: "POST", target: "/api/auth/logout", host: Some("127.0.0.1:4174"),
            cookie: Some("session=abc"), content_type: Some("application/json"),
            origin: Some("http://127.0.0.1:4174"), sec_fetch_site: Some("same-origin"), body: &[],
        });
        assert_eq!(ok.status, 200);
        let cookies: Vec<&str> = ok.extra_headers.iter().filter(|(k, _)| k == "Set-Cookie").map(|(_, v)| v.as_str()).collect();
        assert_eq!(cookies.len(), 2);
        handle.join().unwrap();
    }
}
