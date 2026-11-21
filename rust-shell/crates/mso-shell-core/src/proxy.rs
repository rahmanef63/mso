use crate::origin::HostOrigin;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const MAX_UPSTREAM_BYTES: usize = 1_048_576;
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(10);
const ALLOWED_READ_PATHS: &[&str] = &["/api/auth/me", "/api/v1/sys/stats"];

#[derive(Debug, Clone)]
pub struct ProxyResponse {
    pub status: u16,
    pub content_type: String,
    pub extra_headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

pub fn is_allowlisted_read_path(target: &str) -> bool {
    let path = target.split_once('?').map_or(target, |(p, _)| p);
    ALLOWED_READ_PATHS.contains(&path)
}

pub fn forward_read_request(
    upstream: &HostOrigin,
    method: &str,
    target: &str,
    incoming_host: Option<&str>,
    incoming_cookie: Option<&str>,
) -> ProxyResponse {
    if !is_allowlisted_read_path(target) {
        return json_error(404, "not_found");
    }
    if method != "GET" {
        return ProxyResponse {
            status: 405,
            content_type: "application/json; charset=utf-8".into(),
            extra_headers: vec![("Allow".into(), "GET".into())],
            body: br#"{"error":"method_not_allowed"}"#.to_vec(),
        };
    }
    if upstream.scheme != "http" {
        return json_error(501, "https_loopback_upstream_not_enabled_in_stage_r0");
    }

    let mut stream = match TcpStream::connect(upstream.socket_addr()) {
        Ok(s) => s,
        Err(_) => return json_error(502, "upstream_unavailable"),
    };
    let _ = stream.set_read_timeout(Some(UPSTREAM_TIMEOUT));
    let _ = stream.set_write_timeout(Some(UPSTREAM_TIMEOUT));

    let host_header = incoming_host.unwrap_or(&upstream.host);
    let mut req = format!(
        "GET {target} HTTP/1.1\r\nHost: {host_header}\r\nAccept: application/json\r\nConnection: close\r\n"
    );
    if let Some(cookie) = incoming_cookie {
        if !cookie.contains('\r') && !cookie.contains('\n') {
            req.push_str("Cookie: ");
            req.push_str(cookie);
            req.push_str("\r\n");
        }
    }
    req.push_str("\r\n");

    if stream.write_all(req.as_bytes()).is_err() {
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
    let version = parts.next()?;
    if !version.starts_with("HTTP/1.") {
        return None;
    }
    let status: u16 = parts.next()?.parse().ok()?;
    let mut content_type = "application/octet-stream".to_string();
    let mut chunked = false;
    for line in lines {
        if let Some((name, val)) = line.split_once(':') {
            let key = name.trim().to_ascii_lowercase();
            let v = val.trim();
            if key == "content-type" {
                content_type = v.to_string();
            } else if key == "transfer-encoding" && v.to_ascii_lowercase().contains("chunked") {
                chunked = true;
            }
        }
    }
    let body = if chunked { decode_chunked(body_raw)? } else { body_raw.to_vec() };
    Some(ProxyResponse { status, content_type, extra_headers: Vec::new(), body })
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
    fn enforces_read_only_allowlist_and_forwards_host_and_cookie() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let n = conn.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]);
            assert!(req.contains("Host: 127.0.0.1:4174"));
            assert!(req.contains("Cookie: mso_session=synthetic"));
            let body = r#"{"authenticated":true}"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n",
                body.len(),
                body
            );
            conn.write_all(resp.as_bytes()).unwrap();
        });

        let origin = parse_loopback_origin(&format!("http://127.0.0.1:{port}")).unwrap();
        assert_eq!(forward_read_request(&origin, "POST", "/api/auth/me", None, None).status, 405);
        assert_eq!(forward_read_request(&origin, "GET", "/api/config", None, None).status, 404);

        let ok = forward_read_request(
            &origin,
            "GET",
            "/api/auth/me",
            Some("127.0.0.1:4174"),
            Some("mso_session=synthetic"),
        );
        assert_eq!(ok.status, 200);
        assert_eq!(String::from_utf8_lossy(&ok.body), r#"{"authenticated":true}"#);
        handle.join().unwrap();
    }
}
