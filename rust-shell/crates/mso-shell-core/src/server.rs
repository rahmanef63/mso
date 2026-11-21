use crate::assets::{AssetError, AssetRoot};
use crate::csp::{build_csp_header, generate_nonce, inject_script_nonces};
use crate::csrf::is_cross_origin_mutation;
use crate::http::{
    read_request_with_limit, write_managed_response, write_response, write_response_with_len,
    ParsedRequest, ReadError,
};
use crate::managed::{
    is_blocked_managed_path, is_machine_protocol_path, HostClass, ManagedHostConfig,
};
use crate::origin::HostOrigin;
use crate::proxy::{
    forward_api_request, forward_managed_app_request, match_route_policy, ForwardRequest,
    GLOBAL_MAX_BODY_BYTES,
};
use crate::ws::{is_websocket_upgrade, tunnel_websocket, WsUpgradeRequest};
use std::fs;
use std::io;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const MAX_CONCURRENT_CONNS: usize = 64;
const DEFAULT_UNKNOWN_ROUTE_BODY_LIMIT: usize = 16 * 1024;

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub port: u16,
    pub assets: AssetRoot,
    pub api_origin: Option<HostOrigin>,
    pub managed_hosts: ManagedHostConfig,
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

fn route_body_limit(cfg: &ServerConfig, method: &str, target: &str, host: Option<&str>) -> usize {
    match cfg.managed_hosts.classify_host(host) {
        HostClass::ManagedApp(_) => GLOBAL_MAX_BODY_BYTES,
        HostClass::UnclaimedAppNamespace => DEFAULT_UNKNOWN_ROUTE_BODY_LIMIT,
        HostClass::Cockpit => match match_route_policy(target) {
            Some(policy) if policy.methods.contains(&method) => policy.max_body_bytes,
            Some(policy) => policy.max_body_bytes.max(DEFAULT_UNKNOWN_ROUTE_BODY_LIMIT),
            None => DEFAULT_UNKNOWN_ROUTE_BODY_LIMIT,
        },
    }
}

fn to_forward_req(req: &ParsedRequest) -> ForwardRequest<'_> {
    ForwardRequest {
        method: &req.method,
        target: &req.target,
        host: req.host.as_deref(),
        cookie: req.cookie.as_deref(),
        authorization: req.authorization.as_deref(),
        content_type: req.content_type.as_deref(),
        accept: req.accept.as_deref(),
        origin: req.origin.as_deref(),
        sec_fetch_site: req.sec_fetch_site.as_deref(),
        body: &req.body,
    }
}

fn to_ws_req<'a>(req: &'a ParsedRequest, managed_app_host: Option<&'a str>) -> WsUpgradeRequest<'a> {
    WsUpgradeRequest {
        target: &req.target,
        host: req.host.as_deref(),
        cookie: req.cookie.as_deref(),
        origin: req.origin.as_deref(),
        upgrade: req.upgrade.as_deref(),
        connection: req.connection.as_deref(),
        sec_websocket_key: req.sec_websocket_key.as_deref(),
        sec_websocket_version: req.sec_websocket_version.as_deref(),
        sec_websocket_protocol: req.sec_websocket_protocol.as_deref(),
        sec_websocket_extensions: req.sec_websocket_extensions.as_deref(),
        managed_app_host,
        client_head: &req.ws_head,
    }
}

fn is_term_ws_path(target: &str) -> bool {
    let path = target.split_once('?').map_or(target, |(p, _)| p);
    path.starts_with("/api/v1/term/") && !path.contains("..") && !path.contains('\\')
}

fn handle_managed_app(stream: &mut TcpStream, cfg: &ServerConfig, req: &ParsedRequest, app_id: &str) {
    if is_blocked_managed_path(&req.target) {
        let _ = write_response(stream, 404, "text/plain; charset=utf-8", &[], b"Not Found");
        return;
    }
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
    let Some(upstream) = &cfg.api_origin else {
        let _ = write_response(stream, 404, "text/plain; charset=utf-8", &[], b"Not Found");
        return;
    };
    if is_websocket_upgrade(req.upgrade.as_deref()) {
        if req.method != "GET" {
            let _ = write_response(
                stream,
                405,
                "text/plain; charset=utf-8",
                &[("Allow".into(), "GET".into())],
                b"method not allowed",
            );
            return;
        }
        let _ = tunnel_websocket(stream, upstream, &to_ws_req(req, Some(app_id)));
        return;
    }
    let proxied = forward_managed_app_request(upstream, app_id, &to_forward_req(req));
    let _ = write_managed_response(
        stream,
        proxied.status,
        &proxied.content_type,
        &proxied.extra_headers,
        &proxied.body,
    );
}

fn handle_connection(stream: &mut TcpStream, cfg: &ServerConfig) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));

    let req = match read_request_with_limit(stream, |method, target, host| {
        route_body_limit(cfg, method, target, host)
    }) {
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

    match cfg.managed_hosts.classify_host(req.host.as_deref()) {
        HostClass::UnclaimedAppNamespace => {
            let _ = write_response(
                stream,
                404,
                "text/plain; charset=utf-8",
                &[("Cache-Control".into(), "no-store".into())],
                b"Not Found",
            );
            return;
        }
        HostClass::ManagedApp(app_id) => {
            handle_managed_app(stream, cfg, &req, &app_id);
            return;
        }
        HostClass::Cockpit => {}
    }

    if is_machine_protocol_path(&req.target) {
        if let Some(upstream) = &cfg.api_origin {
            if match_route_policy(&req.target).is_some() {
                let proxied = forward_api_request(upstream, &to_forward_req(&req));
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

    if req.target.starts_with("/api/") {
        if req.method == "GET" && is_term_ws_path(&req.target) && is_websocket_upgrade(req.upgrade.as_deref()) {
            if let Some(upstream) = &cfg.api_origin {
                let _ = tunnel_websocket(stream, upstream, &to_ws_req(&req, None));
                return;
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
                let proxied = forward_api_request(upstream, &to_forward_req(&req));
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
    use crate::origin::parse_loopback_origin;
    use std::io::{Read, Write};
    use std::net::Shutdown;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn enforces_nonce_csp_csrf_403_and_payload_413() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-r2a-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html><script>ok()</script></html>").unwrap();

        let assets = AssetRoot::open(&dir).unwrap();
        let mut srv = start_loopback_server(ServerConfig {
            port: 0,
            assets,
            api_origin: None,
            managed_hosts: ManagedHostConfig::default(),
        })
        .unwrap();

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

        // Oversized Content-Length (>16 KiB on /api/auth/login) must fail with 413 even when global limit is 1 MiB.
        for len in [16_385, 999_999] {
            let mut c3 = TcpStream::connect(srv.addr()).unwrap();
            let req = format!(
                "POST /api/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: {len}\r\n\r\n"
            );
            c3.write_all(req.as_bytes()).unwrap();
            let mut resp3 = String::new();
            c3.read_to_string(&mut resp3).unwrap();
            assert!(resp3.starts_with("HTTP/1.1 413 Payload Too Large"), "len={len}: {resp3}");
            assert!(resp3.contains("request_too_large"));
        }

        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforces_split_origin_machine_protocols_and_websocket_tunnels() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-r2b-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();

        let up_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_port = up_listener.local_addr().unwrap().port();
        let up_thread = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            // 1. Managed app HTTP GET
            let (mut s1, _) = up_listener.accept().unwrap();
            let n1 = s1.read(&mut buf).unwrap();
            let r1 = String::from_utf8_lossy(&buf[..n1]);
            assert!(r1.starts_with("GET /api/v1/managed-apps/hermes/proxy/chat?ok=1 HTTP/1.1"));
            assert!(r1.contains("x-os-managed-app-host: hermes\r\n"));
            s1.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Security-Policy: frame-ancestors https://mso.example.com\r\n\r\n<p>hermes</p>").unwrap();
            drop(s1);

            // 2. Machine protocol POST /mcp (CSRF-exempt, Authorization forwarded, forged app header stripped)
            let (mut s2, _) = up_listener.accept().unwrap();
            let n2 = s2.read(&mut buf).unwrap();
            let r2 = String::from_utf8_lossy(&buf[..n2]);
            assert!(r2.starts_with("POST /mcp HTTP/1.1"));
            assert!(r2.contains("Authorization: Bearer tok-mcp\r\n"));
            assert!(!r2.contains("x-os-managed-app-host"));
            s2.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"jsonrpc\":\"2.0\"}").unwrap();
            drop(s2);

            // 3. Cockpit /api/v1/term/s1 WebSocket upgrade (no forged x-os-managed-app-host)
            let (mut s3, _) = up_listener.accept().unwrap();
            let n3 = s3.read(&mut buf).unwrap();
            let r3 = String::from_utf8_lossy(&buf[..n3]);
            assert!(r3.starts_with("GET /api/v1/term/s1 HTTP/1.1"));
            assert!(!r3.contains("x-os-managed-app-host"));
            s3.write_all(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n").unwrap();
            while let Ok(m) = s3.read(&mut buf) {
                if m == 0 { break; }
                s3.write_all(&buf[..m]).unwrap();
            }
            drop(s3);

            // 4. Managed app WebSocket upgrade (stamps x-os-managed-app-host: hermes)
            let (mut s4, _) = up_listener.accept().unwrap();
            let n4 = s4.read(&mut buf).unwrap();
            let r4 = String::from_utf8_lossy(&buf[..n4]);
            assert!(r4.starts_with("GET /ws?ticket=abc HTTP/1.1"));
            assert!(r4.contains("x-os-managed-app-host: hermes\r\n"));
            s4.write_all(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n").unwrap();
            while let Ok(m) = s4.read(&mut buf) {
                if m == 0 { break; }
                s4.write_all(&buf[..m]).unwrap();
            }
        });

        let assets = AssetRoot::open(&dir).unwrap();
        let api_origin = Some(parse_loopback_origin(&format!("http://127.0.0.1:{up_port}")).unwrap());
        let mut srv = start_loopback_server(ServerConfig {
            port: 0,
            assets,
            api_origin,
            managed_hosts: ManagedHostConfig::from_template(Some("{id}.mso.example.com")),
        })
        .unwrap();

        let send = |raw: &str| {
            let mut c = TcpStream::connect(srv.addr()).unwrap();
            c.write_all(raw.as_bytes()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };

        // Unclaimed subdomain returns 404 plain text
        let r_unclaimed = send("GET / HTTP/1.1\r\nHost: staging.mso.example.com\r\n\r\n");
        assert!(r_unclaimed.starts_with("HTTP/1.1 404 Not Found"));
        assert!(r_unclaimed.contains("text/plain"));

        // Managed app blocks /_next/* with 404 and cross-origin POST with 403
        assert!(send("GET /_next/static/app.js HTTP/1.1\r\nHost: hermes.mso.example.com\r\n\r\n").starts_with("HTTP/1.1 404"));
        assert!(send("POST /api/chat HTTP/1.1\r\nHost: hermes.mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403"));

        // Managed app GET forwards rewritten path and omits X-Frame-Options: DENY
        let r_app = send("GET /chat/?ok=1 HTTP/1.1\r\nHost: hermes.mso.example.com\r\n\r\n");
        assert!(r_app.starts_with("HTTP/1.1 200 OK"));
        assert!(!r_app.contains("X-Frame-Options: DENY"));
        assert!(r_app.contains("<p>hermes</p>"));

        // Cockpit /mcp is CSRF-exempt, forwards Authorization, strips forged app-host header
        let r_mcp = send("POST /mcp HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nAuthorization: Bearer tok-mcp\r\nx-os-managed-app-host: hermes\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r_mcp.starts_with("HTTP/1.1 200 OK"));
        assert!(r_mcp.contains("jsonrpc"));

        // Cockpit /api/v1/term/s1 WebSocket upgrade echoes payload
        let mut ws = TcpStream::connect(srv.addr()).unwrap();
        ws.write_all(b"GET /api/v1/term/s1 HTTP/1.1\r\nHost: mso.example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nx-os-managed-app-host: hermes\r\n\r\necho-me").unwrap();
        ws.shutdown(Shutdown::Write).unwrap();
        let mut ws_resp = Vec::new();
        ws.read_to_end(&mut ws_resp).unwrap();
        drop(ws);
        let ws_text = String::from_utf8_lossy(&ws_resp);
        assert!(ws_text.starts_with("HTTP/1.1 101 Switching Protocols"));
        assert!(ws_text.ends_with("echo-me"));

        // Managed app WebSocket upgrade echoes payload with stamped x-os-managed-app-host
        let mut mws = TcpStream::connect(srv.addr()).unwrap();
        mws.write_all(b"GET /ws?ticket=abc HTTP/1.1\r\nHost: hermes.mso.example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\napp-ws").unwrap();
        mws.shutdown(Shutdown::Write).unwrap();
        let mut mws_resp = Vec::new();
        mws.read_to_end(&mut mws_resp).unwrap();
        drop(mws);
        let mws_text = String::from_utf8_lossy(&mws_resp);
        assert!(mws_text.starts_with("HTTP/1.1 101 Switching Protocols"));
        assert!(mws_text.ends_with("app-ws"));

        up_thread.join().unwrap();
        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }
}
