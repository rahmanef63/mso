use std::io::{self, Read, Write};
use std::net::TcpStream;

pub const MAX_HEADER_BYTES: usize = 8192;

#[derive(Debug, Clone)]
pub struct ParsedRequest {
    pub method: String,
    pub target: String,
    pub host: Option<String>,
    pub x_forwarded_host: Option<String>,
    pub cookie: Option<String>,
    pub authorization: Option<String>,
    pub accept: Option<String>,
    pub origin: Option<String>,
    pub sec_fetch_site: Option<String>,
    pub content_type: Option<String>,
    pub upgrade: Option<String>,
    pub connection: Option<String>,
    pub sec_websocket_key: Option<String>,
    pub sec_websocket_version: Option<String>,
    pub sec_websocket_protocol: Option<String>,
    pub sec_websocket_extensions: Option<String>,
    pub content_length: usize,
    pub has_transfer_encoding: bool,
    pub body: Vec<u8>,
    pub ws_head: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    BadRequest,
    PayloadTooLarge,
}

pub fn read_request(stream: &mut TcpStream, max_body_bytes: usize) -> Result<ParsedRequest, ReadError> {
    read_request_with_limit(stream, |_, _, _| max_body_bytes)
}

pub fn read_request_with_limit<F>(stream: &mut TcpStream, max_body_for: F) -> Result<ParsedRequest, ReadError>
where
    F: FnOnce(&str, &str, Option<&str>) -> usize,
{
    let mut raw = Vec::new();
    let mut buf = [0u8; 2048];
    let header_end = loop {
        let n = stream.read(&mut buf).map_err(|_| ReadError::BadRequest)?;
        if n == 0 {
            return Err(ReadError::BadRequest);
        }
        raw.extend_from_slice(&buf[..n]);
        if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if raw.len() > MAX_HEADER_BYTES {
            return Err(ReadError::BadRequest);
        }
    };

    if header_end > MAX_HEADER_BYTES {
        return Err(ReadError::BadRequest);
    }
    let head = std::str::from_utf8(&raw[..header_end]).map_err(|_| ReadError::BadRequest)?;
    let mut lines = head.split("\r\n");
    let mut first = lines.next().ok_or(ReadError::BadRequest)?.split_whitespace();
    let method = first.next().ok_or(ReadError::BadRequest)?.to_string();
    let target = first.next().ok_or(ReadError::BadRequest)?.to_string();
    let version = first.next().ok_or(ReadError::BadRequest)?;
    if !version.starts_with("HTTP/1.") {
        return Err(ReadError::BadRequest);
    }

    let mut host = None;
    let mut x_forwarded_host = None;
    let mut cookie = None;
    let mut authorization = None;
    let mut accept = None;
    let mut origin = None;
    let mut sec_fetch_site = None;
    let mut content_type = None;
    let mut upgrade = None;
    let mut connection = None;
    let mut sec_websocket_key = None;
    let mut sec_websocket_version = None;
    let mut sec_websocket_protocol = None;
    let mut sec_websocket_extensions = None;
    let mut content_length: usize = 0;
    let mut has_transfer_encoding = false;

    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            let val = v.trim();
            match k.trim().to_ascii_lowercase().as_str() {
                "host" => host = Some(val.to_string()),
                "x-forwarded-host" => x_forwarded_host = Some(val.to_string()),
                "cookie" => cookie = Some(val.to_string()),
                "authorization" => authorization = Some(val.to_string()),
                "accept" => accept = Some(val.to_string()),
                "origin" => origin = Some(val.to_string()),
                "sec-fetch-site" => sec_fetch_site = Some(val.to_string()),
                "content-type" => content_type = Some(val.to_string()),
                "upgrade" => upgrade = Some(val.to_string()),
                "connection" => connection = Some(val.to_string()),
                "sec-websocket-key" => sec_websocket_key = Some(val.to_string()),
                "sec-websocket-version" => sec_websocket_version = Some(val.to_string()),
                "sec-websocket-protocol" => sec_websocket_protocol = Some(val.to_string()),
                "sec-websocket-extensions" => sec_websocket_extensions = Some(val.to_string()),
                "content-length" => {
                    content_length = val.parse().map_err(|_| ReadError::BadRequest)?;
                }
                "transfer-encoding" => has_transfer_encoding = true,
                // Deliberately ignore client-supplied `x-os-managed-app-host` and other headers.
                _ => {}
            }
        }
    }

    if has_transfer_encoding {
        return Err(ReadError::BadRequest);
    }
    let max_body_bytes = max_body_for(&method, &target, host.as_deref());
    if content_length > max_body_bytes {
        return Err(ReadError::PayloadTooLarge);
    }

    let trailing = &raw[header_end + 4..];
    let ws_head = if content_length == 0 && upgrade.is_some() {
        trailing.to_vec()
    } else {
        Vec::new()
    };
    let mut body = trailing.to_vec();
    if body.len() > content_length {
        body.truncate(content_length);
    }
    while body.len() < content_length {
        let remaining = content_length - body.len();
        let to_read = remaining.min(buf.len());
        let n = stream.read(&mut buf[..to_read]).map_err(|_| ReadError::BadRequest)?;
        if n == 0 {
            return Err(ReadError::BadRequest);
        }
        body.extend_from_slice(&buf[..n]);
    }

    Ok(ParsedRequest {
        method,
        target,
        host,
        x_forwarded_host,
        cookie,
        authorization,
        accept,
        origin,
        sec_fetch_site,
        content_type,
        upgrade,
        connection,
        sec_websocket_key,
        sec_websocket_version,
        sec_websocket_protocol,
        sec_websocket_extensions,
        content_length,
        has_transfer_encoding,
        body,
        ws_head,
    })
}

pub fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    extra: &[(String, String)],
    body: &[u8],
) -> io::Result<()> {
    write_response_inner(stream, status, content_type, extra, body.len(), body, true)
}

pub fn write_response_with_len(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    extra: &[(String, String)],
    content_len: usize,
    body: &[u8],
) -> io::Result<()> {
    write_response_inner(stream, status, content_type, extra, content_len, body, true)
}

pub fn write_managed_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    extra: &[(String, String)],
    body: &[u8],
) -> io::Result<()> {
    write_response_inner(stream, status, content_type, extra, body.len(), body, false)
}

fn write_response_inner(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    extra: &[(String, String)],
    content_len: usize,
    body: &[u8],
    cockpit_headers: bool,
) -> io::Result<()> {
    let reason = match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        307 => "Temporary Redirect",
        308 => "Permanent Redirect",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        413 => "Payload Too Large",
        422 => "Unprocessable Entity",
        426 => "Upgrade Required",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {content_len}\r\n\
         X-Content-Type-Options: nosniff\r\n\
         Referrer-Policy: no-referrer\r\n\
         Connection: close\r\n"
    );
    if cockpit_headers {
        head.push_str("X-Frame-Options: DENY\r\nCross-Origin-Opener-Policy: same-origin\r\n");
    }
    for (k, v) in extra {
        if !k.contains('\r') && !k.contains('\n') && !v.contains('\r') && !v.contains('\n') {
            head.push_str(k);
            head.push_str(": ");
            head.push_str(v);
            head.push_str("\r\n");
        }
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    if !body.is_empty() {
        stream.write_all(body)?;
    }
    Ok(())
}
