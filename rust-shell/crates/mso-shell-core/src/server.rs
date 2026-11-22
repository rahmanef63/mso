use crate::assets::{AssetError, AssetRoot};
use crate::csp::{build_csp_header, generate_nonce, inject_script_nonces};
use crate::origin::HostOrigin;
use crate::proxy::{forward_read_request, is_allowlisted_read_path};
use std::fs;
use std::io::{self, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const MAX_HEADER_BYTES: usize = 8192;
const MAX_CONCURRENT_CONNS: usize = 64;

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub port: u16,
    pub assets: AssetRoot,
    pub api_origin: Option<HostOrigin>,
}

pub struct RunningServer {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
    join: Option<thread::JoinHandle<()>>,
}

impl RunningServer {
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.addr);
        if let Some(handle) = self.join.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for RunningServer {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn start_loopback_server(config: ServerConfig) -> io::Result<RunningServer> {
    let listener = TcpListener::bind(("127.0.0.1", config.port))?;
    let addr = listener.local_addr()?;
    let stop = Arc::new(AtomicBool::new(false));
    let active = Arc::new(AtomicUsize::new(0));
    let stop_flag = Arc::clone(&stop);
    let shared_cfg = Arc::new(config);

    let join = thread::spawn(move || {
        for incoming in listener.incoming() {
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }
            let Ok(mut stream) = incoming else { continue };
            if active.load(Ordering::Acquire) >= MAX_CONCURRENT_CONNS {
                let _ = write_response(&mut stream, 503, "text/plain; charset=utf-8", &[], b"busy");
                continue;
            }
            active.fetch_add(1, Ordering::AcqRel);
            let cfg = Arc::clone(&shared_cfg);
            let counter = Arc::clone(&active);
            thread::spawn(move || {
                handle_connection(&mut stream, &cfg);
                counter.fetch_sub(1, Ordering::AcqRel);
            });
        }
    });

    Ok(RunningServer { addr, stop, join: Some(join) })
}

fn handle_connection(stream: &mut TcpStream, cfg: &ServerConfig) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));

    let Some(req) = read_request_head(stream) else {
        let _ = write_response(stream, 400, "text/plain; charset=utf-8", &[], b"bad request");
        return;
    };

    if req.target.starts_with("/api/") {
        if let Some(upstream) = &cfg.api_origin {
            if is_allowlisted_read_path(&req.target) {
                let proxied = forward_read_request(
                    upstream,
                    &req.method,
                    &req.target,
                    req.host.as_deref(),
                    req.cookie.as_deref(),
                );
                let mut headers = proxied.extra_headers;
                headers.push(("Cache-Control".into(), "no-store".into()));
                let _ = write_response(stream, proxied.status, &proxied.content_type, &headers, &proxied.body);
                return;
            }
        }
        let _ = write_response(
            stream,
            404,
            "application/json; charset=utf-8",
            &[("Cache-Control".into(), "no-store".into())],
            br#"{"error":"not_found"}"#,
        );
        return;
    }

    if req.method != "GET" && req.method != "HEAD" {
        let _ = write_response(
            stream,
            405,
            "text/plain; charset=utf-8",
            &[("Allow".into(), "GET, HEAD".into())],
            b"method not allowed",
        );
        return;
    }

    match cfg.assets.resolve(&req.target) {
        Ok(asset) => {
            let Ok(bytes) = fs::read(&asset.path) else {
                let _ = write_response(stream, 500, "text/plain; charset=utf-8", &[], b"read error");
                return;
            };
            let mut headers = Vec::new();
            let body = if asset.is_html {
                let nonce = generate_nonce();
                headers.push(("Content-Security-Policy".into(), build_csp_header(&nonce)));
                headers.push(("X-Nonce".into(), nonce.clone()));
                headers.push(("Cache-Control".into(), "no-store".into()));
                let text = String::from_utf8_lossy(&bytes);
                inject_script_nonces(&text, &nonce).into_bytes()
            } else if asset.immutable {
                headers.push(("Cache-Control".into(), "public, max-age=31536000, immutable".into()));
                bytes
            } else {
                headers.push(("Cache-Control".into(), "no-cache".into()));
                bytes
            };
            let payload: &[u8] = if req.method == "HEAD" { &[] } else { &body };
            let _ = write_response_with_len(stream, 200, asset.content_type, &headers, body.len(), payload);
        }
        Err(AssetError::BadPath) => {
            let _ = write_response(stream, 400, "text/plain; charset=utf-8", &[], b"invalid path");
        }
        Err(AssetError::ReservedPath | AssetError::NotFound) => {
            let _ = write_response(stream, 404, "text/plain; charset=utf-8", &[], b"not found");
        }
    }
}

struct ParsedRequest {
    method: String,
    target: String,
    host: Option<String>,
    cookie: Option<String>,
}

fn read_request_head(stream: &mut TcpStream) -> Option<ParsedRequest> {
    let mut raw = Vec::new();
    let mut buf = [0u8; 1024];
    loop {
        let n = stream.read(&mut buf).ok()?;
        if n == 0 {
            return None;
        }
        if raw.len() + n > MAX_HEADER_BYTES {
            return None;
        }
        raw.extend_from_slice(&buf[..n]);
        if let Some(end) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = std::str::from_utf8(&raw[..end]).ok()?;
            let mut lines = head.split("\r\n");
            let mut first = lines.next()?.split_whitespace();
            let method = first.next()?.to_string();
            let target = first.next()?.to_string();
            let _version = first.next()?;
            let mut host = None;
            let mut cookie = None;
            for line in lines {
                if let Some((k, v)) = line.split_once(':') {
                    match k.trim().to_ascii_lowercase().as_str() {
                        "host" => host = Some(v.trim().to_string()),
                        "cookie" => cookie = Some(v.trim().to_string()),
                        _ => {}
                    }
                }
            }
            return Some(ParsedRequest { method, target, host, cookie });
        }
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    extra: &[(String, String)],
    body: &[u8],
) -> io::Result<()> {
    write_response_with_len(stream, status, content_type, extra, body.len(), body)
}

fn write_response_with_len(
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
        head.push_str(k);
        head.push_str(": ");
        head.push_str(v);
        head.push_str("\r\n");
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    if !body.is_empty() {
        stream.write_all(body)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn serves_html_with_matching_nonce_csp_and_blocks_api_fallback() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html><script>ok()</script></html>").unwrap();

        let assets = AssetRoot::open(&dir).unwrap();
        let mut srv = start_loopback_server(ServerConfig { port: 0, assets, api_origin: None }).unwrap();

        let mut c1 = TcpStream::connect(srv.addr()).unwrap();
        c1.write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut resp = String::new();
        c1.read_to_string(&mut resp).unwrap();
        assert!(resp.starts_with("HTTP/1.1 200 OK"));
        let nonce_line = resp.lines().find(|l| l.starts_with("X-Nonce: ")).unwrap();
        let nonce = nonce_line.trim_start_matches("X-Nonce: ").trim();
        assert!(resp.contains(&format!("<script nonce=\"{nonce}\">ok()</script>")));
        assert!(resp.contains(&format!("script-src 'self' 'nonce-{nonce}'")));

        let mut c2 = TcpStream::connect(srv.addr()).unwrap();
        c2.write_all(b"GET /api/auth/me HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut resp2 = String::new();
        c2.read_to_string(&mut resp2).unwrap();
        assert!(resp2.starts_with("HTTP/1.1 404 Not Found"));
        assert!(!resp2.contains("<html>"));

        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }
}
