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
    pub origin: Option<String>,
    pub sec_fetch_site: Option<String>,
    pub content_type: Option<String>,
    pub content_length: usize,
    pub has_transfer_encoding: bool,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    BadRequest,
    PayloadTooLarge,
}

pub fn read_request(stream: &mut TcpStream, max_body_bytes: usize) -> Result<ParsedRequest, ReadError> {
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
    let mut origin = None;
    let mut sec_fetch_site = None;
    let mut content_type = None;
    let mut content_length: usize = 0;
    let mut has_transfer_encoding = false;

    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            let val = v.trim();
            match k.trim().to_ascii_lowercase().as_str() {
                "host" => host = Some(val.to_string()),
                "x-forwarded-host" => x_forwarded_host = Some(val.to_string()),
                "cookie" => cookie = Some(val.to_string()),
                "origin" => origin = Some(val.to_string()),
                "sec-fetch-site" => sec_fetch_site = Some(val.to_string()),
                "content-type" => content_type = Some(val.to_string()),
                "content-length" => {
                    content_length = val.parse().map_err(|_| ReadError::BadRequest)?;
                }
                "transfer-encoding" => has_transfer_encoding = true,
                _ => {}
            }
        }
    }

    if has_transfer_encoding {
        return Err(ReadError::BadRequest);
    }
    if content_length > max_body_bytes {
        return Err(ReadError::PayloadTooLarge);
    }

    let mut body = raw[header_end + 4..].to_vec();
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
        origin,
        sec_fetch_site,
        content_type,
        content_length,
        has_transfer_encoding,
        body,
    })
}

pub fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    extra: &[(String, String)],
    body: &[u8],
) -> io::Result<()> {
    write_response_with_len(stream, status, content_type, extra, body.len(), body)
}

pub fn write_response_with_len(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    extra: &[(String, String)],
    content_len: usize,
    body: &[u8],
) -> io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        413 => "Payload Too Large",
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
         X-Frame-Options: DENY\r\n\
         Referrer-Policy: no-referrer\r\n\
         Cross-Origin-Opener-Policy: same-origin\r\n\
         Connection: close\r\n"
    );
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
