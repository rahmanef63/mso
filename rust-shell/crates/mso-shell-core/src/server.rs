use crate::assets::{AssetError, AssetRoot};
use crate::csp::{build_csp_header, generate_nonce, inject_script_nonces};
use crate::csrf::is_cross_origin_mutation;
use crate::http::{read_request, write_response, write_response_with_len, ReadError};
use crate::origin::HostOrigin;
use crate::proxy::{forward_api_request, match_route_policy, ForwardRequest, GLOBAL_MAX_BODY_BYTES};
use std::fs;
use std::io;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

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

    let req = match read_request(stream, GLOBAL_MAX_BODY_BYTES) {
        Ok(r) => r,
        Err(ReadError::PayloadTooLarge) => {
            let _ = write_response(
                stream,
                413,
                "application/json; charset=utf-8",
                &[("Cache-Control".into(), "no-store".into())],
                br#"{"error":"request_too_large"}"#,
            );
            return;
        }
        Err(ReadError::BadRequest) => {
            let _ = write_response(stream, 400, "text/plain; charset=utf-8", &[], b"bad request");
            return;
        }
    };

    if req.target.starts_with("/api/") {
        if is_cross_origin_mutation(
            &req.method,
            req.sec_fetch_site.as_deref(),
            req.origin.as_deref(),
            req.host.as_deref(),
            req.x_forwarded_host.as_deref(),
            req.cookie.as_deref(),
        ) {
            let _ = write_response(
                stream,
                403,
                "application/json; charset=utf-8",
                &[("Cache-Control".into(), "no-store".into())],
                br#"{"error":"cross_origin_blocked"}"#,
            );
            return;
        }
        if let Some(upstream) = &cfg.api_origin {
            if match_route_policy(&req.target).is_some() {
                let proxied = forward_api_request(upstream, &ForwardRequest {
                    method: &req.method,
                    target: &req.target,
                    host: req.host.as_deref(),
                    cookie: req.cookie.as_deref(),
                    content_type: req.content_type.as_deref(),
                    origin: req.origin.as_deref(),
                    sec_fetch_site: req.sec_fetch_site.as_deref(),
                    body: &req.body,
                });
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn enforces_nonce_csp_csrf_403_and_payload_413() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-r2a-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html><script>ok()</script></html>").unwrap();

        let assets = AssetRoot::open(&dir).unwrap();
        let mut srv = start_loopback_server(ServerConfig { port: 0, assets, api_origin: None }).unwrap();

        let mut c1 = TcpStream::connect(srv.addr()).unwrap();
        c1.write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut resp = String::new();
        c1.read_to_string(&mut resp).unwrap();
        assert!(resp.starts_with("HTTP/1.1 200 OK"));
        let nonce = resp.lines().find(|l| l.starts_with("X-Nonce: ")).unwrap().trim_start_matches("X-Nonce: ").trim();
        assert!(resp.contains(&format!("<script nonce=\"{nonce}\">ok()</script>")));

        // Cross-origin POST must fail with 403 cross_origin_blocked.
        let mut c2 = TcpStream::connect(srv.addr()).unwrap();
        c2.write_all(b"POST /api/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").unwrap();
        let mut resp2 = String::new();
        c2.read_to_string(&mut resp2).unwrap();
        assert!(resp2.starts_with("HTTP/1.1 403 Forbidden"));
        assert!(resp2.contains("cross_origin_blocked"));

        // Oversized Content-Length must fail with 413 request_too_large.
        let mut c3 = TcpStream::connect(srv.addr()).unwrap();
        c3.write_all(b"POST /api/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 999999\r\n\r\n").unwrap();
        let mut resp3 = String::new();
        c3.read_to_string(&mut resp3).unwrap();
        assert!(resp3.starts_with("HTTP/1.1 413 Payload Too Large"));
        assert!(resp3.contains("request_too_large"));

        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }
}
