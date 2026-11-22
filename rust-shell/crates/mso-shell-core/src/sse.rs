use crate::http::{write_response, MAX_HEADER_BYTES};
use crate::origin::HostOrigin;
use crate::proxy::decode_chunked;
use std::io::{self, ErrorKind, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::Duration;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ERROR_BODY_BYTES: usize = 64 * 1024;
pub const ASSISTANT_MAX_BODY_BYTES: usize = 256 * 1024;
const SSE_HEAD: &[u8] = concat!(
    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\n",
    "Cache-Control: no-cache, no-store\r\nX-Content-Type-Options: nosniff\r\n",
    "Referrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\n",
    "Cross-Origin-Opener-Policy: same-origin\r\nX-Accel-Buffering: no\r\nConnection: close\r\n\r\n",
).as_bytes();

#[derive(Debug, Clone)]
pub struct SseRequest<'a> {
    pub method: &'a str,
    pub target: &'a str,
    pub host: Option<&'a str>,
    pub cookie: Option<&'a str>,
    pub last_event_id: Option<&'a str>,
    pub content_type: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub sec_fetch_site: Option<&'a str>,
    pub body: &'a [u8],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SseOutcome { Streamed, RelayedError(u16), Rejected(u16) }

pub fn is_term_stream_path(target: &str) -> bool {
    target.split_once('?').map_or(target, |(p, _)| p) == "/api/v1/term/stream"
}

pub fn is_assistant_stream_path(target: &str) -> bool {
    target.split_once('?').map_or(target, |(p, _)| p) == "/api/assistant"
}

pub fn stream_sse_request(client: &mut TcpStream, upstream: &HostOrigin, req: &SseRequest<'_>) -> SseOutcome {
    let (allow_method, max_body) = if is_assistant_stream_path(req.target) {
        ("POST", ASSISTANT_MAX_BODY_BYTES)
    } else if is_term_stream_path(req.target) {
        ("GET", 0)
    } else {
        return reject(client, 404, "not_found");
    };
    if req.method != allow_method {
        let extra = [("Allow".into(), allow_method.into()), ("Cache-Control".into(), "no-store".into())];
        let _ = write_response(client, 405, "application/json; charset=utf-8", &extra, br#"{"error":"method_not_allowed"}"#);
        return SseOutcome::Rejected(405);
    }
    if req.body.len() > max_body { return reject(client, 413, "request_too_large"); }
    if upstream.scheme != "http" || !upstream.is_loopback() { return reject(client, 502, "upstream_unavailable"); }
    if req.target.len() > MAX_HEADER_BYTES || !req.target.starts_with('/') || !is_safe(req.target) { return reject(client, 400, "bad_request"); }
    let Ok(mut up) = TcpStream::connect(upstream.socket_addr()) else { return reject(client, 502, "upstream_unavailable"); };
    let _ = up.set_read_timeout(Some(HANDSHAKE_TIMEOUT));
    let _ = up.set_write_timeout(Some(HANDSHAKE_TIMEOUT));
    let host = req.host.filter(|h| is_safe(h)).unwrap_or(&upstream.host);
    let mut wire = format!("{} {} HTTP/1.1\r\nHost: {host}\r\nAccept: text/event-stream\r\nConnection: close\r\n", req.method, req.target);
    for (k, v) in [("Cookie", req.cookie), ("Last-Event-ID", req.last_event_id), ("Origin", req.origin), ("Sec-Fetch-Site", req.sec_fetch_site)] {
        if let Some(val) = v.filter(|s| is_safe(s)) { wire.push_str(&format!("{k}: {val}\r\n")); }
    }
    if req.method == "POST" {
        let ct = req.content_type.filter(|s| is_safe(s)).unwrap_or("application/json");
        wire.push_str(&format!("Content-Type: {ct}\r\nContent-Length: {}\r\n", req.body.len()));
    }
    wire.push_str("\r\n");
    if up.write_all(wire.as_bytes()).is_err() || (!req.body.is_empty() && up.write_all(req.body).is_err()) {
        return reject(client, 502, "upstream_write_failed");
    }
    let (mut raw, mut buf) = (Vec::new(), [0u8; 2048]);
    let sep = loop {
        match read_retry(&mut up, &mut buf) {
            Ok(0) | Err(_) => return reject(client, 502, "upstream_read_failed"),
            Ok(n) => {
                raw.extend_from_slice(&buf[..n]);
                if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") { break pos; }
                if raw.len() > MAX_HEADER_BYTES { return reject(client, 502, "upstream_header_too_large"); }
            }
        }
    };
    if sep > MAX_HEADER_BYTES { return reject(client, 502, "upstream_header_too_large"); }
    let Some((status, ct, chunked)) = parse_head(&raw[..sep]) else { return reject(client, 502, "upstream_malformed_response"); };
    let initial = &raw[sep + 4..];
    if status != 200 || !ct.to_ascii_lowercase().contains("text/event-stream") {
        let mut body_raw = initial.to_vec();
        loop {
            match read_retry(&mut up, &mut buf) {
                Ok(0) => break,
                Ok(n) if body_raw.len() + n <= MAX_ERROR_BODY_BYTES => body_raw.extend_from_slice(&buf[..n]),
                Ok(_) => return reject(client, 502, "upstream_response_too_large"),
                Err(_) => return reject(client, 502, "upstream_read_failed"),
            }
        }
        let body = if chunked {
            let Some(b) = decode_chunked(&body_raw) else { return reject(client, 502, "upstream_malformed_response"); };
            b
        } else { body_raw };
        let _ = write_response(client, status, &ct, &[("Cache-Control".into(), "no-store".into())], &body);
        return SseOutcome::RelayedError(status);
    }
    let _ = up.set_read_timeout(None);
    let _ = client.set_nodelay(true);
    if write_flush(client, SSE_HEAD).is_ok() {
        let _ = if chunked { stream_chunked(&mut up, initial, client) } else { stream_raw(&mut up, initial, client) };
    }
    let _ = up.shutdown(Shutdown::Both);
    let _ = client.shutdown(Shutdown::Both);
    SseOutcome::Streamed
}

fn stream_raw(up: &mut TcpStream, initial: &[u8], client: &mut TcpStream) -> io::Result<()> {
    if !initial.is_empty() { write_flush(client, initial)?; }
    let mut buf = [0u8; 4096];
    loop {
        let n = read_retry(up, &mut buf)?;
        if n == 0 { return Ok(()); }
        write_flush(client, &buf[..n])?;
    }
}
fn stream_chunked(up: &mut TcpStream, initial: &[u8], client: &mut TcpStream) -> io::Result<()> {
    let (mut buf, mut tmp) = (initial.to_vec(), [0u8; 4096]);
    let bad = |m| io::Error::new(ErrorKind::InvalidData, m);
    loop {
        let crlf = loop {
            if let Some(pos) = buf.windows(2).position(|w| w == b"\r\n") { break pos; }
            if buf.len() > 256 { return Err(bad("chunk header")); }
            let n = read_retry(up, &mut tmp)?;
            if n == 0 { return Ok(()); }
            buf.extend_from_slice(&tmp[..n]);
        };
        let line = std::str::from_utf8(&buf[..crlf]).map_err(|_| bad("chunk utf8"))?;
        let mut rem = usize::from_str_radix(line.split(';').next().unwrap_or("").trim(), 16).map_err(|_| bad("chunk hex"))?;
        buf.drain(..crlf + 2);
        if rem == 0 { return Ok(()); }
        while rem > 0 {
            if !buf.is_empty() {
                let take = rem.min(buf.len());
                write_flush(client, &buf[..take])?; buf.drain(..take); rem -= take;
            } else {
                let lim = rem.min(tmp.len());
                let n = read_retry(up, &mut tmp[..lim])?;
                if n == 0 { return Ok(()); }
                write_flush(client, &tmp[..n])?; rem -= n;
            }
        }
        while buf.len() < 2 {
            let n = read_retry(up, &mut tmp)?;
            if n == 0 { return Ok(()); }
            buf.extend_from_slice(&tmp[..n]);
        }
        if &buf[..2] != b"\r\n" { return Err(bad("chunk crlf")); }
        buf.drain(..2);
    }
}

fn parse_head(head: &[u8]) -> Option<(u16, String, bool)> {
    let mut lines = std::str::from_utf8(head).ok()?.split("\r\n");
    let mut parts = lines.next()?.split_whitespace();
    if !parts.next()?.starts_with("HTTP/1.") { return None; }
    let status: u16 = parts.next()?.parse().ok()?;
    let (mut ct, mut chunked) = ("application/octet-stream".to_string(), false);
    for (k, v) in lines.filter_map(|l| l.split_once(':')) {
        match k.trim().to_ascii_lowercase().as_str() {
            "content-type" => ct = v.trim().to_string(),
            "transfer-encoding" if v.to_ascii_lowercase().contains("chunked") => chunked = true,
            _ => {}
        }
    }
    Some((status, ct, chunked))
}
fn write_flush(s: &mut TcpStream, b: &[u8]) -> io::Result<()> { s.write_all(b)?; s.flush() }
fn read_retry(s: &mut TcpStream, b: &mut [u8]) -> io::Result<usize> {
    loop { match s.read(b) { Err(e) if e.kind() == ErrorKind::Interrupted => continue, other => return other } }
}
fn is_safe(v: &str) -> bool { !v.is_empty() && !v.contains('\r') && !v.contains('\n') }
fn reject(c: &mut TcpStream, status: u16, code: &str) -> SseOutcome {
    let _ = write_response(c, status, "application/json; charset=utf-8", &[("Cache-Control".into(), "no-store".into())], format!(r#"{{"error":"{code}"}}"#).as_bytes());
    SseOutcome::Rejected(status)
}
