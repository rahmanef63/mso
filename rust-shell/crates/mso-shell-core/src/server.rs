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
use crate::sse::{
    is_assistant_stream_path, is_term_stream_path, stream_sse_request, SseRequest,
    ASSISTANT_MAX_BODY_BYTES,
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
        HostClass::Cockpit => {
            if is_assistant_stream_path(target) {
                return if method == "POST" {
                    ASSISTANT_MAX_BODY_BYTES
                } else {
                    DEFAULT_UNKNOWN_ROUTE_BODY_LIMIT
                };
            }
            match match_route_policy(target) {
                Some(policy) if policy.methods.contains(&method) => policy.max_body_bytes,
                Some(policy) => policy.max_body_bytes.max(DEFAULT_UNKNOWN_ROUTE_BODY_LIMIT),
                None => DEFAULT_UNKNOWN_ROUTE_BODY_LIMIT,
            }
        }
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

fn to_sse_req(req: &ParsedRequest) -> SseRequest<'_> {
    SseRequest {
        method: &req.method,
        target: &req.target,
        host: req.host.as_deref(),
        cookie: req.cookie.as_deref(),
        last_event_id: req.last_event_id.as_deref(),
        content_type: req.content_type.as_deref(),
        origin: req.origin.as_deref(),
        sec_fetch_site: req.sec_fetch_site.as_deref(),
        body: &req.body,
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
        if is_term_stream_path(&req.target) || is_assistant_stream_path(&req.target) {
            if let Some(upstream) = &cfg.api_origin {
                let _ = stream_sse_request(stream, upstream, &to_sse_req(&req));
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
        let _guard = crate::ws::WS_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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

    #[test]
    fn streams_terminal_sse_incrementally_chunked_and_unchunked() {
        use std::sync::mpsc;

        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-sse-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();

        let up_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_port = up_listener.local_addr().unwrap().port();
        let (tx_c1, rx_c1) = mpsc::channel::<()>();
        let (tx_c2, rx_c2) = mpsc::channel::<()>();
        let (tx_r1, rx_r1) = mpsc::channel::<()>();
        let (tx_r2, rx_r2) = mpsc::channel::<()>();

        let up_thread = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            // 1. Chunked SSE stream with barrier after each event before EOF
            let (mut s1, _) = up_listener.accept().unwrap();
            let n1 = s1.read(&mut buf).unwrap();
            let r1 = String::from_utf8_lossy(&buf[..n1]);
            assert!(r1.starts_with("GET /api/v1/term/stream?id=pty-1 HTTP/1.1"));
            assert!(r1.contains("Accept: text/event-stream\r\n"));
            assert!(r1.contains("Cookie: session=ok\r\n"));
            assert!(r1.contains("Last-Event-ID: 42\r\n"));
            assert!(r1.contains("Connection: close\r\n"));
            let ev1 = b"id: 1\nevent: data\ndata: first\n\n";
            let ev2 = b"id: 2\nevent: data\ndata: second\n\n";
            s1.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
            s1.write_all(format!("{:x}\r\n", ev1.len()).as_bytes()).unwrap();
            s1.write_all(ev1).unwrap();
            s1.write_all(b"\r\n").unwrap();
            s1.flush().unwrap();
            rx_c1.recv_timeout(Duration::from_secs(5)).expect("client must receive chunked event 1 before event 2");
            // Split event 2 across two writes to prove incremental chunked decoding
            s1.write_all(format!("{:x}\r\n", ev2.len()).as_bytes()).unwrap();
            s1.write_all(&ev2[..10]).unwrap();
            s1.flush().unwrap();
            s1.write_all(&ev2[10..]).unwrap();
            s1.write_all(b"\r\n").unwrap();
            s1.flush().unwrap();
            rx_c2.recv_timeout(Duration::from_secs(5)).expect("client must receive chunked event 2 before EOF");
            s1.write_all(b"0\r\n\r\n").unwrap();
            s1.flush().unwrap();
            drop(s1);

            // 2. Non-chunked SSE stream with barrier after each event before EOF
            let (mut s2, _) = up_listener.accept().unwrap();
            let n2 = s2.read(&mut buf).unwrap();
            let r2 = String::from_utf8_lossy(&buf[..n2]);
            assert!(r2.starts_with("GET /api/v1/term/stream?id=pty-2 HTTP/1.1"));
            s2.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").unwrap();
            s2.write_all(ev1).unwrap();
            s2.flush().unwrap();
            rx_r1.recv_timeout(Duration::from_secs(5)).expect("client must receive raw event 1 before event 2");
            s2.write_all(ev2).unwrap();
            s2.flush().unwrap();
            rx_r2.recv_timeout(Duration::from_secs(5)).expect("client must receive raw event 2 before EOF");
            drop(s2);

            // 3. Upstream 401 JSON error on /api/v1/term/stream
            let (mut s3, _) = up_listener.accept().unwrap();
            let _ = s3.read(&mut buf).unwrap();
            s3.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{\"error\":\"unauthorized\"}").unwrap();
            drop(s3);
        });

        let assets = AssetRoot::open(&dir).unwrap();
        let api_origin = Some(parse_loopback_origin(&format!("http://127.0.0.1:{up_port}")).unwrap());
        let mut srv = start_loopback_server(ServerConfig {
            port: 0,
            assets,
            api_origin,
            managed_hosts: ManagedHostConfig::default(),
        })
        .unwrap();

        let read_until = |sock: &mut TcpStream, acc: &mut String, needle: &str| {
            let mut b = [0u8; 512];
            while !acc.contains(needle) {
                let n = sock.read(&mut b).expect("expected incremental SSE bytes before timeout");
                assert!(n > 0, "unexpected EOF waiting for {needle:?}, got: {acc:?}");
                acc.push_str(&String::from_utf8_lossy(&b[..n]));
            }
        };

        // Case 1: Chunked SSE
        let mut c1 = TcpStream::connect(srv.addr()).unwrap();
        c1.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        c1.write_all(b"GET /api/v1/term/stream?id=pty-1 HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: session=ok\r\nLast-Event-ID: 42\r\n\r\n").unwrap();
        let mut out1 = String::new();
        read_until(&mut c1, &mut out1, "data: first\n\n");
        assert!(out1.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(out1.contains("Content-Type: text/event-stream; charset=utf-8\r\n"));
        assert!(out1.contains("Cache-Control: no-cache, no-store\r\n"));
        assert!(out1.contains("X-Content-Type-Options: nosniff\r\n"));
        assert!(out1.contains("Connection: close\r\n"));
        tx_c1.send(()).unwrap();
        read_until(&mut c1, &mut out1, "data: second\n\n");
        tx_c2.send(()).unwrap();
        let mut tail1 = String::new();
        c1.read_to_string(&mut tail1).unwrap();
        assert!(tail1.is_empty(), "expected clean EOF after 0-chunk, got: {tail1:?}");

        // Case 2: Non-chunked SSE
        let mut c2 = TcpStream::connect(srv.addr()).unwrap();
        c2.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        c2.write_all(b"GET /api/v1/term/stream?id=pty-2 HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: session=ok\r\n\r\n").unwrap();
        let mut out2 = String::new();
        read_until(&mut c2, &mut out2, "data: first\n\n");
        tx_r1.send(()).unwrap();
        read_until(&mut c2, &mut out2, "data: second\n\n");
        tx_r2.send(()).unwrap();
        let mut tail2 = String::new();
        c2.read_to_string(&mut tail2).unwrap();
        assert!(tail2.is_empty());

        // Case 3: Upstream 401 JSON relays cleanly
        let mut c3 = TcpStream::connect(srv.addr()).unwrap();
        c3.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        c3.write_all(b"GET /api/v1/term/stream?id=pty-3 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut out3 = String::new();
        c3.read_to_string(&mut out3).unwrap();
        assert!(out3.starts_with("HTTP/1.1 401 Unauthorized"));
        assert!(out3.contains(r#"{"error":"unauthorized"}"#));

        // Case 4: Non-GET on /api/v1/term/stream returns 405 + Allow: GET (same-origin) and 403 (cross-site)
        let mut c4 = TcpStream::connect(srv.addr()).unwrap();
        c4.write_all(b"POST /api/v1/term/stream HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 0\r\n\r\n").unwrap();
        let mut out4 = String::new();
        c4.read_to_string(&mut out4).unwrap();
        assert!(out4.starts_with("HTTP/1.1 405 Method Not Allowed"));
        assert!(out4.contains("Allow: GET\r\n"));

        let mut c5 = TcpStream::connect(srv.addr()).unwrap();
        c5.write_all(b"POST /api/v1/term/stream HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 0\r\n\r\n").unwrap();
        let mut out5 = String::new();
        c5.read_to_string(&mut out5).unwrap();
        assert!(out5.starts_with("HTTP/1.1 403 Forbidden"));

        up_thread.join().unwrap();
        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforces_increment_3b_routes_csrf_and_unlisted_exec_run() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-3b-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();

        let up_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_port = up_listener.local_addr().unwrap().port();
        let up_thread = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            // 1. DELETE /api/v1/fs/delete
            let (mut s1, _) = up_listener.accept().unwrap();
            let n1 = s1.read(&mut buf).unwrap();
            let r1 = String::from_utf8_lossy(&buf[..n1]);
            assert!(r1.starts_with("DELETE /api/v1/fs/delete HTTP/1.1"));
            assert!(r1.contains(r#"{"path":"tmp/a.txt"}"#));
            s1.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}").unwrap();
            drop(s1);

            // 2. GET /api/v1/sys/services
            let (mut s2, _) = up_listener.accept().unwrap();
            let n2 = s2.read(&mut buf).unwrap();
            let r2 = String::from_utf8_lossy(&buf[..n2]);
            assert!(r2.starts_with("GET /api/v1/sys/services HTTP/1.1"));
            s2.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"services\":[]}").unwrap();
            drop(s2);

            // 3. POST /api/v1/sys/services
            let (mut s3, _) = up_listener.accept().unwrap();
            let n3 = s3.read(&mut buf).unwrap();
            let r3 = String::from_utf8_lossy(&buf[..n3]);
            assert!(r3.starts_with("POST /api/v1/sys/services HTTP/1.1"));
            assert!(r3.contains(r#"{"action":"restart"}"#));
            s3.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}").unwrap();
            drop(s3);
        });

        let assets = AssetRoot::open(&dir).unwrap();
        let api_origin = Some(parse_loopback_origin(&format!("http://127.0.0.1:{up_port}")).unwrap());
        let mut srv = start_loopback_server(ServerConfig {
            port: 0,
            assets,
            api_origin,
            managed_hosts: ManagedHostConfig::default(),
        })
        .unwrap();

        let send = |raw: &str| {
            let mut c = TcpStream::connect(srv.addr()).unwrap();
            c.write_all(raw.as_bytes()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };

        // /api/v1/fs/delete: CSRF-blocked cross-origin, 405 on GET, 200 on same-origin DELETE
        assert!(send("DELETE /api/v1/fs/delete HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 20\r\n\r\n{\"path\":\"tmp/a.txt\"}").starts_with("HTTP/1.1 403 Forbidden"));
        let del_get = send("GET /api/v1/fs/delete HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert!(del_get.starts_with("HTTP/1.1 405 Method Not Allowed") && del_get.contains("Allow: DELETE\r\n"));
        let del_ok = send("DELETE /api/v1/fs/delete HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{\"path\":\"tmp/a.txt\"}");
        assert!(del_ok.starts_with("HTTP/1.1 200 OK") && del_ok.contains(r#"{"ok":true}"#));

        // /api/v1/sys/services: GET allowed, POST CSRF-blocked cross-origin, 405 on DELETE, 200 on same-origin POST
        let svc_get = send("GET /api/v1/sys/services HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert!(svc_get.starts_with("HTTP/1.1 200 OK") && svc_get.contains(r#"{"services":[]}"#));
        assert!(send("POST /api/v1/sys/services HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 20\r\n\r\n{\"action\":\"restart\"}").starts_with("HTTP/1.1 403 Forbidden"));
        let svc_del = send("DELETE /api/v1/sys/services HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(svc_del.starts_with("HTTP/1.1 405 Method Not Allowed") && svc_del.contains("Allow: GET, POST\r\n"));
        let svc_post = send("POST /api/v1/sys/services HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{\"action\":\"restart\"}");
        assert!(svc_post.starts_with("HTTP/1.1 200 OK") && svc_post.contains(r#"{"ok":true}"#));

        // /api/v1/exec/run MUST remain unlisted (404)
        let exec_post = send("POST /api/v1/exec/run HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(exec_post.starts_with("HTTP/1.1 404 Not Found") && exec_post.contains("not_found"));
        let exec_get = send("GET /api/v1/exec/run HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert!(exec_get.starts_with("HTTP/1.1 404 Not Found"));

        up_thread.join().unwrap();
        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sse_rejects_non_loopback_or_https_upstream_and_matches_exact_path() {
        use crate::sse::SseOutcome;

        assert!(is_term_stream_path("/api/v1/term/stream"));
        assert!(is_term_stream_path("/api/v1/term/stream?id=abc"));
        assert!(!is_term_stream_path("/api/v1/term/stream/extra"));
        assert!(!is_term_stream_path("/api/v1/term/open"));

        assert!(is_assistant_stream_path("/api/assistant"));
        assert!(is_assistant_stream_path("/api/assistant?mode=fast"));
        assert!(!is_assistant_stream_path("/api/assistant/extra"));
        assert!(!is_assistant_stream_path("/api/assistant2"));

        let bad_origins = [
            HostOrigin { scheme: "https".into(), host: "127.0.0.1".into(), port: 8443 },
            HostOrigin { scheme: "http".into(), host: "10.0.0.5".into(), port: 4005 },
        ];
        for bad in bad_origins {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = l.local_addr().unwrap();
            let h = thread::spawn(move || {
                let (mut s, _) = l.accept().unwrap();
                stream_sse_request(&mut s, &bad, &SseRequest {
                    method: "GET",
                    target: "/api/v1/term/stream?id=1",
                    host: Some("127.0.0.1"),
                    cookie: None,
                    last_event_id: None,
                    content_type: None,
                    origin: None,
                    sec_fetch_site: None,
                    body: &[],
                })
            });
            let mut c = TcpStream::connect(addr).unwrap();
            let mut resp = String::new();
            c.read_to_string(&mut resp).unwrap();
            assert!(resp.starts_with("HTTP/1.1 502 Bad Gateway"));
            assert_eq!(h.join().unwrap(), SseOutcome::Rejected(502));
        }

        // Direct sse.rs body-limit defense in depth (>256 KiB => 413) and unlisted path => 404
        let ok_origin = HostOrigin { scheme: "http".into(), host: "127.0.0.1".into(), port: 4005 };
        {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = l.local_addr().unwrap();
            let orig = ok_origin.clone();
            let h = thread::spawn(move || {
                let (mut s, _) = l.accept().unwrap();
                let big = vec![b'a'; ASSISTANT_MAX_BODY_BYTES + 1];
                stream_sse_request(&mut s, &orig, &SseRequest {
                    method: "POST",
                    target: "/api/assistant",
                    host: Some("127.0.0.1"),
                    cookie: None,
                    last_event_id: None,
                    content_type: Some("application/json"),
                    origin: None,
                    sec_fetch_site: Some("same-origin"),
                    body: &big,
                })
            });
            let mut c = TcpStream::connect(addr).unwrap();
            let mut resp = String::new();
            c.read_to_string(&mut resp).unwrap();
            assert!(resp.starts_with("HTTP/1.1 413 Payload Too Large"));
            assert_eq!(h.join().unwrap(), SseOutcome::Rejected(413));
        }
        {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = l.local_addr().unwrap();
            let h = thread::spawn(move || {
                let (mut s, _) = l.accept().unwrap();
                stream_sse_request(&mut s, &ok_origin, &SseRequest {
                    method: "GET",
                    target: "/api/config",
                    host: Some("127.0.0.1"),
                    cookie: None,
                    last_event_id: None,
                    content_type: None,
                    origin: None,
                    sec_fetch_site: None,
                    body: &[],
                })
            });
            let mut c = TcpStream::connect(addr).unwrap();
            let mut resp = String::new();
            c.read_to_string(&mut resp).unwrap();
            assert!(resp.starts_with("HTTP/1.1 404 Not Found"));
            assert_eq!(h.join().unwrap(), SseOutcome::Rejected(404));
        }
    }

    #[test]
    fn streams_assistant_post_sse_incrementally_and_enforces_csrf_and_limits() {
        use std::sync::mpsc;

        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-assistant-sse-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();

        let up_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_port = up_listener.local_addr().unwrap().port();
        let (tx_ev1, rx_ev1) = mpsc::channel::<()>();
        let (tx_ev2, rx_ev2) = mpsc::channel::<()>();

        let req_body = r#"{"messages":[{"role":"user","text":"hello alfa"}]}"#;
        let expected_body = req_body.to_string();

        let up_thread = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            // 1. Streaming POST /api/assistant (chunked SSE with incremental barrier)
            let (mut s1, _) = up_listener.accept().unwrap();
            let mut got = Vec::new();
            loop {
                let n = s1.read(&mut buf).unwrap();
                assert!(n > 0);
                got.extend_from_slice(&buf[..n]);
                if let Some(sep) = got.windows(4).position(|w| w == b"\r\n\r\n") {
                    if got.len() >= sep + 4 + expected_body.len() {
                        break;
                    }
                }
            }
            let raw_req = String::from_utf8_lossy(&got);
            assert!(raw_req.starts_with("POST /api/assistant HTTP/1.1\r\n"), "got: {raw_req}");
            assert!(raw_req.contains("Host: 127.0.0.1\r\n"));
            assert!(raw_req.contains("Cookie: session=tok-alfa\r\n"));
            assert!(raw_req.contains("Content-Type: application/json\r\n"));
            assert!(raw_req.contains(&format!("Content-Length: {}\r\n", expected_body.len())));
            assert!(raw_req.contains("Origin: http://127.0.0.1\r\n"));
            assert!(raw_req.contains("Sec-Fetch-Site: same-origin\r\n"));
            assert!(raw_req.contains("Accept: text/event-stream\r\n"));
            assert!(raw_req.ends_with(&expected_body), "body mismatch: {raw_req}");

            let ev1 = b"event: delta\ndata: \"hello \"\n\n";
            let ev2 = b"event: done\ndata: {\"stopReason\":\"stop\"}\n\n";
            s1.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
            s1.write_all(format!("{:x}\r\n", ev1.len()).as_bytes()).unwrap();
            s1.write_all(ev1).unwrap();
            s1.write_all(b"\r\n").unwrap();
            s1.flush().unwrap();
            rx_ev1.recv_timeout(Duration::from_secs(5)).expect("client must receive assistant event 1 before upstream closes");
            s1.write_all(format!("{:x}\r\n", ev2.len()).as_bytes()).unwrap();
            s1.write_all(ev2).unwrap();
            s1.write_all(b"\r\n").unwrap();
            s1.flush().unwrap();
            rx_ev2.recv_timeout(Duration::from_secs(5)).expect("client must receive assistant event 2 before EOF");
            s1.write_all(b"0\r\n\r\n").unwrap();
            s1.flush().unwrap();
            drop(s1);

            // 2. Upstream 401 JSON error on POST /api/assistant
            let (mut s2, _) = up_listener.accept().unwrap();
            let _ = s2.read(&mut buf).unwrap();
            s2.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{\"error\":\"unauthorized\"}").unwrap();
            drop(s2);

            // 3. Upstream 400 JSON error on POST /api/assistant
            let (mut s3, _) = up_listener.accept().unwrap();
            let _ = s3.read(&mut buf).unwrap();
            s3.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n\r\n{\"error\":\"empty\"}").unwrap();
            drop(s3);
        });

        let assets = AssetRoot::open(&dir).unwrap();
        let api_origin = Some(parse_loopback_origin(&format!("http://127.0.0.1:{up_port}")).unwrap());
        let mut srv = start_loopback_server(ServerConfig {
            port: 0,
            assets,
            api_origin,
            managed_hosts: ManagedHostConfig::default(),
        })
        .unwrap();

        let read_until = |sock: &mut TcpStream, acc: &mut String, needle: &str| {
            let mut b = [0u8; 512];
            while !acc.contains(needle) {
                let n = sock.read(&mut b).expect("expected incremental assistant SSE bytes");
                assert!(n > 0, "unexpected EOF waiting for {needle:?}, got: {acc:?}");
                acc.push_str(&String::from_utf8_lossy(&b[..n]));
            }
        };

        // 1. Streaming POST /api/assistant delivers event 1 before upstream sends event 2 or closes
        let mut c1 = TcpStream::connect(srv.addr()).unwrap();
        c1.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let req1 = format!(
            "POST /api/assistant HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: session=tok-alfa\r\nOrigin: http://127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        c1.write_all(req1.as_bytes()).unwrap();
        let mut out1 = String::new();
        read_until(&mut c1, &mut out1, "event: delta\ndata: \"hello \"\n\n");
        assert!(out1.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(out1.contains("Content-Type: text/event-stream; charset=utf-8\r\n"));
        assert!(out1.contains("X-Accel-Buffering: no\r\n"));
        tx_ev1.send(()).unwrap();
        read_until(&mut c1, &mut out1, "event: done\ndata: {\"stopReason\":\"stop\"}\n\n");
        tx_ev2.send(()).unwrap();
        let mut tail = String::new();
        c1.read_to_string(&mut tail).unwrap();
        assert!(tail.is_empty());

        let send = |raw: &str| {
            let mut c = TcpStream::connect(srv.addr()).unwrap();
            c.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            c.write_all(raw.as_bytes()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };

        // 2. Non-200 JSON responses relay cleanly (401 and 400)
        let r401 = send("POST /api/assistant HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r401.starts_with("HTTP/1.1 401 Unauthorized") && r401.contains(r#"{"error":"unauthorized"}"#));
        let r400 = send("POST /api/assistant HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r400.starts_with("HTTP/1.1 400 Bad Request") && r400.contains(r#"{"error":"empty"}"#));

        // 3. Method enforcement: GET /api/assistant => 405 + Allow: POST
        let r405 = send("GET /api/assistant HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert!(r405.starts_with("HTTP/1.1 405 Method Not Allowed") && r405.contains("Allow: POST\r\n"));

        // 4. CSRF depth-2 enforcement: cross-site POST => 403
        let r403 = send("POST /api/assistant HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r403.starts_with("HTTP/1.1 403 Forbidden") && r403.contains("cross_origin_blocked"));

        // 5. Payload limit enforcement: >256 KiB => 413
        let r413 = send(&format!(
            "POST /api/assistant HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            ASSISTANT_MAX_BODY_BYTES + 1
        ));
        assert!(r413.starts_with("HTTP/1.1 413 Payload Too Large") && r413.contains("request_too_large"));

        up_thread.join().unwrap();
        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforces_stage_r3b_routes_methods_csrf_and_unlisted_guards() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-r3b-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();

        let up_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_port = up_listener.local_addr().unwrap().port();
        let up_thread = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let cases: &[(&str, &str)] = &[
                ("GET /api/prefs HTTP/1.1", r#"{"theme":"dark"}"#),
                ("POST /api/prefs HTTP/1.1", r#"{"saved":true}"#),
                ("GET /api/models HTTP/1.1", r#"{"models":[]}"#),
                ("GET /api/threads HTTP/1.1", r#"{"threads":[]}"#),
                ("POST /api/threads HTTP/1.1", r#"{"id":"t1"}"#),
                ("PATCH /api/threads HTTP/1.1", r#"{"id":"t1","title":"renamed"}"#),
                ("DELETE /api/threads?id=t1 HTTP/1.1", r#"{"deleted":true}"#),
                ("GET /api/v1/managed-apps HTTP/1.1", r#"{"apps":[]}"#),
                ("GET /api/v1/sys/packages HTTP/1.1", r#"{"packages":[]}"#),
            ];
            for (expected_line, resp_body) in cases {
                let (mut s, _) = up_listener.accept().unwrap();
                let n = s.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                assert!(req.starts_with(expected_line), "expected {expected_line}, got: {req}");
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{resp_body}");
                s.write_all(resp.as_bytes()).unwrap();
            }
        });

        let assets = AssetRoot::open(&dir).unwrap();
        let api_origin = Some(parse_loopback_origin(&format!("http://127.0.0.1:{up_port}")).unwrap());
        let mut srv = start_loopback_server(ServerConfig {
            port: 0,
            assets,
            api_origin,
            managed_hosts: ManagedHostConfig::default(),
        })
        .unwrap();

        let send = |raw: &str| {
            let mut c = TcpStream::connect(srv.addr()).unwrap();
            c.write_all(raw.as_bytes()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };

        // /api/prefs: GET + POST (CSRF-protected, <=64 KiB)
        assert!(send("GET /api/prefs HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").starts_with("HTTP/1.1 200 OK"));
        assert!(send("POST /api/prefs HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let prefs_del = send("DELETE /api/prefs HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(prefs_del.starts_with("HTTP/1.1 405 Method Not Allowed") && prefs_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/prefs HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        assert!(send("POST /api/prefs HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 16\r\n\r\n{\"theme\":\"dark\"}").starts_with("HTTP/1.1 200 OK"));

        // /api/models: GET only
        assert!(send("GET /api/models HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").starts_with("HTTP/1.1 200 OK"));
        let models_post = send("POST /api/models HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(models_post.starts_with("HTTP/1.1 405 Method Not Allowed") && models_post.contains("Allow: GET\r\n"));
        assert!(send("POST /api/models HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));

        // /api/threads: GET, POST, PATCH, DELETE (CSRF-protected on mutating)
        assert!(send("GET /api/threads HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").starts_with("HTTP/1.1 200 OK"));
        assert!(send("POST /api/threads HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        assert!(send("PATCH /api/threads HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        assert!(send("DELETE /api/threads?id=t1 HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\n\r\n").starts_with("HTTP/1.1 403 Forbidden"));
        let threads_put = send("PUT /api/threads HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(threads_put.starts_with("HTTP/1.1 405 Method Not Allowed") && threads_put.contains("Allow: GET, POST, PATCH, DELETE\r\n"));
        assert!(send("POST /api/threads HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 200 OK"));
        assert!(send("PATCH /api/threads HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 200 OK"));
        assert!(send("DELETE /api/threads?id=t1 HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\n\r\n").starts_with("HTTP/1.1 200 OK"));

        // /api/v1/managed-apps: GET only
        assert!(send("GET /api/v1/managed-apps HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").starts_with("HTTP/1.1 200 OK"));
        let apps_post = send("POST /api/v1/managed-apps HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(apps_post.starts_with("HTTP/1.1 405 Method Not Allowed") && apps_post.contains("Allow: GET\r\n"));
        assert!(send("POST /api/v1/managed-apps HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));

        // /api/v1/sys/packages: GET only
        assert!(send("GET /api/v1/sys/packages HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").starts_with("HTTP/1.1 200 OK"));
        let pkg_post = send("POST /api/v1/sys/packages HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(pkg_post.starts_with("HTTP/1.1 405 Method Not Allowed") && pkg_post.contains("Allow: GET\r\n"));
        assert!(send("POST /api/v1/sys/packages HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));

        // /api/config and /api/v1/exec/run MUST remain strictly unlisted (404)
        assert!(send("GET /api/config HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").starts_with("HTTP/1.1 404 Not Found"));
        assert!(send("POST /api/config HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 404 Not Found"));
        assert!(send("GET /api/v1/exec/run HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").starts_with("HTTP/1.1 404 Not Found"));
        assert!(send("POST /api/v1/exec/run HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 404 Not Found"));

        up_thread.join().unwrap();
        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforces_stage_r3c_routes_methods_csrf_limits_and_unlisted_guards() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-r3c-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();

        let up_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_port = up_listener.local_addr().unwrap().port();
        let up_thread = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let cases: &[(&str, &str)] = &[
                ("GET /api/changelog?limit=20 HTTP/1.1", r#"{"entries":[]}"#),
                ("GET /api/skills?action=list HTTP/1.1", r#"{"skills":[]}"#),
                ("GET /api/memory?scope=global HTTP/1.1", r#"{"items":[]}"#),
                ("POST /api/memory?action=upsert HTTP/1.1", r#"{"saved":true}"#),
                ("GET /api/v1/memory-graph?depth=2 HTTP/1.1", r#"{"nodes":[]}"#),
                ("GET /api/v1/workflows?runs=1 HTTP/1.1", r#"{"workflows":[],"runs":[]}"#),
                ("POST /api/v1/workflows?runs=1 HTTP/1.1", r#"{"runId":"wf-1"}"#),
                ("GET /api/v1/integrations?action=list HTTP/1.1", r#"{"integrations":[]}"#),
                ("POST /api/v1/integrations?action=list HTTP/1.1", r#"{"ok":true}"#),
                ("GET /api/v1/channels?action=list HTTP/1.1", r#"{"channels":[]}"#),
                ("POST /api/v1/channels HTTP/1.1", r#"{"ok":true}"#),
                ("GET /api/v1/organization?action=list HTTP/1.1", r#"{"members":[]}"#),
                ("POST /api/v1/organization HTTP/1.1", r#"{"ok":true}"#),
            ];
            for (expected_line, resp_body) in cases {
                let (mut s, _) = up_listener.accept().unwrap();
                let n = s.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                assert!(req.starts_with(expected_line), "expected {expected_line}, got: {req}");
                assert!(req.contains("Host: mso.example.com\r\n"), "Host not preserved: {req}");
                assert!(req.contains("Cookie: session=r3c-tok\r\n"), "Cookie not preserved: {req}");
                assert!(!req.contains("Authorization:"), "Authorization must not be forwarded: {req}");
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{resp_body}");
                s.write_all(resp.as_bytes()).unwrap();
            }
        });

        let assets = AssetRoot::open(&dir).unwrap();
        let api_origin = Some(parse_loopback_origin(&format!("http://127.0.0.1:{up_port}")).unwrap());
        let mut srv = start_loopback_server(ServerConfig {
            port: 0,
            assets,
            api_origin,
            managed_hosts: ManagedHostConfig::default(),
        })
        .unwrap();

        let send = |raw: &str| {
            let mut c = TcpStream::connect(srv.addr()).unwrap();
            c.write_all(raw.as_bytes()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };

        // Unlisted routes MUST return 404 without contacting upstream (tested before valid requests so any upstream hit breaks order)
        for unlisted in [
            "/api/config",
            "/api/v1/exec/run",
            "/api/v1/editor/exec",
            "/api/changelog/extra",
            "/api/v1/workflows/extra",
        ] {
            let r_get = send(&format!("GET {unlisted} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\n\r\n"));
            assert!(r_get.starts_with("HTTP/1.1 404 Not Found") && r_get.contains("not_found"), "GET {unlisted}: {r_get}");
            let r_post = send(&format!("POST {unlisted} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{{}}"));
            assert!(r_post.starts_with("HTTP/1.1 404 Not Found") && r_post.contains("not_found"), "POST {unlisted}: {r_post}");
        }

        // /api/changelog: GET only
        let r = send("GET /api/changelog?limit=20 HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\nAuthorization: Bearer strip\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"entries":[]}"#));
        assert!(send("POST /api/changelog HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let ch_post = send("POST /api/changelog HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(ch_post.starts_with("HTTP/1.1 405 Method Not Allowed") && ch_post.contains("Allow: GET\r\n"));

        // /api/skills: GET only
        let r = send("GET /api/skills?action=list HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\nAuthorization: Bearer strip\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"skills":[]}"#));
        assert!(send("POST /api/skills HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let sk_post = send("POST /api/skills HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(sk_post.starts_with("HTTP/1.1 405 Method Not Allowed") && sk_post.contains("Allow: GET\r\n"));

        // /api/memory: GET + POST (<=65,536 bytes, CSRF-protected)
        let r = send("GET /api/memory?scope=global HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"items":[]}"#));
        assert!(send("POST /api/memory HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let mem_del = send("DELETE /api/memory HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(mem_del.starts_with("HTTP/1.1 405 Method Not Allowed") && mem_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/memory HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/memory?action=upsert HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\nAuthorization: Bearer strip\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"saved":true}"#));

        // /api/v1/memory-graph: GET only
        let r = send("GET /api/v1/memory-graph?depth=2 HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"nodes":[]}"#));
        assert!(send("POST /api/v1/memory-graph HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let mg_post = send("POST /api/v1/memory-graph HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(mg_post.starts_with("HTTP/1.1 405 Method Not Allowed") && mg_post.contains("Allow: GET\r\n"));

        // /api/v1/workflows: GET + POST (<=262,144 bytes, CSRF-protected)
        let r = send("GET /api/v1/workflows?runs=1 HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"workflows":[],"runs":[]}"#));
        assert!(send("POST /api/v1/workflows HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let wf_del = send("DELETE /api/v1/workflows HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(wf_del.starts_with("HTTP/1.1 405 Method Not Allowed") && wf_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/workflows HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 262145\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/workflows?runs=1 HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"runId":"wf-1"}"#));

        // /api/v1/integrations: GET + POST (<=65,536 bytes, CSRF-protected)
        let r = send("GET /api/v1/integrations?action=list HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"integrations":[]}"#));
        assert!(send("POST /api/v1/integrations HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let int_del = send("DELETE /api/v1/integrations HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(int_del.starts_with("HTTP/1.1 405 Method Not Allowed") && int_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/integrations HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/integrations?action=list HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"ok":true}"#));

        // /api/v1/channels: GET + POST (<=65,536 bytes, CSRF-protected)
        let r = send("GET /api/v1/channels?action=list HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"channels":[]}"#));
        assert!(send("POST /api/v1/channels HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let chn_del = send("DELETE /api/v1/channels HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(chn_del.starts_with("HTTP/1.1 405 Method Not Allowed") && chn_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/channels HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/channels HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"ok":true}"#));

        // /api/v1/organization: GET + POST (<=65,536 bytes, CSRF-protected)
        let r = send("GET /api/v1/organization?action=list HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"members":[]}"#));
        assert!(send("POST /api/v1/organization HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let org_del = send("DELETE /api/v1/organization HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(org_del.starts_with("HTTP/1.1 405 Method Not Allowed") && org_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/organization HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/organization HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3c-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"ok":true}"#));

        up_thread.join().unwrap();
        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforces_stage_r3d_routes_methods_csrf_limits_and_unlisted_guards() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-r3d-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();

        let up_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_port = up_listener.local_addr().unwrap().port();
        let up_thread = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let cases: &[(&str, &str)] = &[
                ("GET /api/v1/app-catalog?category=all HTTP/1.1", r#"{"catalog":[]}"#),
                ("GET /api/v1/features?installed=1 HTTP/1.1", r#"{"features":[]}"#),
                ("GET /api/v1/sys/audit?limit=50 HTTP/1.1", r#"{"events":[]}"#),
                ("GET /api/v1/infra/providers?action=list HTTP/1.1", r#"{"providers":[]}"#),
                ("POST /api/v1/infra/providers?action=upsert HTTP/1.1", r#"{"saved":true}"#),
                ("DELETE /api/v1/infra/providers?providerId=cloudflare HTTP/1.1", r#"{"deleted":true}"#),
                ("GET /api/v1/agent-vault?scope=project HTTP/1.1", r#"{"notes":[]}"#),
                ("POST /api/v1/agent-vault?action=sync HTTP/1.1", r#"{"synced":true}"#),
                ("GET /api/v1/agent-groups HTTP/1.1", r#"{"groups":[]}"#),
                ("POST /api/v1/agent-groups HTTP/1.1", r#"{"groupId":"g-1"}"#),
                ("GET /api/v1/agent-profiles HTTP/1.1", r#"{"profiles":[]}"#),
                ("POST /api/v1/agent-profiles HTTP/1.1", r#"{"profileId":"p-1"}"#),
                ("GET /api/v1/agent-sessions?limit=20 HTTP/1.1", r#"{"sessions":[]}"#),
                ("POST /api/v1/agent-sessions?action=open HTTP/1.1", r#"{"sessionId":"s-1"}"#),
            ];
            for (expected_line, resp_body) in cases {
                let (mut s, _) = up_listener.accept().unwrap();
                let n = s.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                assert!(req.starts_with(expected_line), "expected {expected_line}, got: {req}");
                assert!(req.contains("Host: mso.example.com\r\n"), "Host not preserved: {req}");
                assert!(req.contains("Cookie: session=r3d-tok\r\n"), "Cookie not preserved: {req}");
                assert!(!req.contains("Authorization:"), "Authorization must not be forwarded: {req}");
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{resp_body}");
                s.write_all(resp.as_bytes()).unwrap();
            }
        });

        let assets = AssetRoot::open(&dir).unwrap();
        let api_origin = Some(parse_loopback_origin(&format!("http://127.0.0.1:{up_port}")).unwrap());
        let mut srv = start_loopback_server(ServerConfig {
            port: 0,
            assets,
            api_origin,
            managed_hosts: ManagedHostConfig::default(),
        })
        .unwrap();

        let send = |raw: &str| {
            let mut c = TcpStream::connect(srv.addr()).unwrap();
            c.write_all(raw.as_bytes()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };

        // Unlisted routes and subpaths MUST return 404 without contacting upstream
        for unlisted in [
            "/api/config",
            "/api/v1/exec/run",
            "/api/v1/editor/exec",
            "/api/v1/app-catalog/extra",
            "/api/v1/infra/providers/extra",
            "/api/v1/agent-sessions/extra",
        ] {
            let r_get = send(&format!("GET {unlisted} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\n\r\n"));
            assert!(r_get.starts_with("HTTP/1.1 404 Not Found") && r_get.contains("not_found"), "GET {unlisted}: {r_get}");
            let r_post = send(&format!("POST {unlisted} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{{}}"));
            assert!(r_post.starts_with("HTTP/1.1 404 Not Found") && r_post.contains("not_found"), "POST {unlisted}: {r_post}");
        }

        // /api/v1/app-catalog: GET only
        let r = send("GET /api/v1/app-catalog?category=all HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\nAuthorization: Bearer strip\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"catalog":[]}"#));
        assert!(send("POST /api/v1/app-catalog HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let cat_post = send("POST /api/v1/app-catalog HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(cat_post.starts_with("HTTP/1.1 405 Method Not Allowed") && cat_post.contains("Allow: GET\r\n"));

        // /api/v1/features: GET only
        let r = send("GET /api/v1/features?installed=1 HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\nAuthorization: Bearer strip\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"features":[]}"#));
        assert!(send("POST /api/v1/features HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let feat_post = send("POST /api/v1/features HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(feat_post.starts_with("HTTP/1.1 405 Method Not Allowed") && feat_post.contains("Allow: GET\r\n"));

        // /api/v1/sys/audit: GET only
        let r = send("GET /api/v1/sys/audit?limit=50 HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\nAuthorization: Bearer strip\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"events":[]}"#));
        assert!(send("POST /api/v1/sys/audit HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let aud_post = send("POST /api/v1/sys/audit HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(aud_post.starts_with("HTTP/1.1 405 Method Not Allowed") && aud_post.contains("Allow: GET\r\n"));

        // /api/v1/infra/providers: GET, POST, DELETE (<=65,536 bytes, CSRF depth-2 on POST & DELETE)
        let r = send("GET /api/v1/infra/providers?action=list HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"providers":[]}"#));
        assert!(send("POST /api/v1/infra/providers HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        assert!(send("DELETE /api/v1/infra/providers?providerId=cloudflare HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\n\r\n").starts_with("HTTP/1.1 403 Forbidden"));
        let prov_patch = send("PATCH /api/v1/infra/providers HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(prov_patch.starts_with("HTTP/1.1 405 Method Not Allowed") && prov_patch.contains("Allow: GET, POST, DELETE\r\n"));
        assert!(send("POST /api/v1/infra/providers HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        assert!(send("DELETE /api/v1/infra/providers HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r_post = send("POST /api/v1/infra/providers?action=upsert HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\nAuthorization: Bearer strip\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r_post.starts_with("HTTP/1.1 200 OK") && r_post.contains(r#"{"saved":true}"#));
        let r_del = send("DELETE /api/v1/infra/providers?providerId=cloudflare HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\nAuthorization: Bearer strip\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(r_del.starts_with("HTTP/1.1 200 OK") && r_del.contains(r#"{"deleted":true}"#));

        // /api/v1/agent-vault: GET + POST (<=65,536 bytes, CSRF-protected)
        let r = send("GET /api/v1/agent-vault?scope=project HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"notes":[]}"#));
        assert!(send("POST /api/v1/agent-vault HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let av_del = send("DELETE /api/v1/agent-vault HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(av_del.starts_with("HTTP/1.1 405 Method Not Allowed") && av_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/agent-vault HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/agent-vault?action=sync HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"synced":true}"#));

        // /api/v1/agent-groups: GET + POST (<=65,536 bytes, CSRF-protected)
        let r = send("GET /api/v1/agent-groups HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"groups":[]}"#));
        assert!(send("POST /api/v1/agent-groups HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let ag_del = send("DELETE /api/v1/agent-groups HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(ag_del.starts_with("HTTP/1.1 405 Method Not Allowed") && ag_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/agent-groups HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/agent-groups HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"groupId":"g-1"}"#));

        // /api/v1/agent-profiles: GET + POST (<=65,536 bytes, CSRF-protected)
        let r = send("GET /api/v1/agent-profiles HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"profiles":[]}"#));
        assert!(send("POST /api/v1/agent-profiles HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let ap_del = send("DELETE /api/v1/agent-profiles HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(ap_del.starts_with("HTTP/1.1 405 Method Not Allowed") && ap_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/agent-profiles HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/agent-profiles HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"profileId":"p-1"}"#));

        // /api/v1/agent-sessions: GET + POST (<=65,536 bytes, CSRF-protected)
        let r = send("GET /api/v1/agent-sessions?limit=20 HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"sessions":[]}"#));
        assert!(send("POST /api/v1/agent-sessions HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let as_del = send("DELETE /api/v1/agent-sessions HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(as_del.starts_with("HTTP/1.1 405 Method Not Allowed") && as_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/agent-sessions HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/agent-sessions?action=open HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3d-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"sessionId":"s-1"}"#));

        up_thread.join().unwrap();
        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforces_stage_r3e_routes_methods_csrf_limits_and_unlisted_guards() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-r3e-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();

        let up_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_port = up_listener.local_addr().unwrap().port();
        let up_thread = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let cases: &[(&str, &str)] = &[
                ("GET /api/v1/shell-apps HTTP/1.1", r#"{"apps":[]}"#),
                ("POST /api/v1/shell-apps HTTP/1.1", r#"{"installed":true}"#),
                ("GET /api/v1/camoufox/service HTTP/1.1", r#"{"running":false}"#),
                ("POST /api/v1/camoufox/service HTTP/1.1", r#"{"started":true}"#),
                ("GET /api/v1/camoufox/session HTTP/1.1", r#"{"sessions":[]}"#),
                ("POST /api/v1/camoufox/session HTTP/1.1", r#"{"sessionId":"cf-1"}"#),
                ("DELETE /api/v1/camoufox/session?id=cf-1 HTTP/1.1", r#"{"closed":true}"#),
                ("GET /api/v1/desktop/containers HTTP/1.1", r#"{"containers":[]}"#),
                ("POST /api/v1/desktop/containers HTTP/1.1", r#"{"containerId":"dc-1"}"#),
                ("POST /api/v1/desktop/lifecycle HTTP/1.1", r#"{"state":"started"}"#),
                ("GET /api/v1/fs/raw?path=notes.txt HTTP/1.1", r#"{"content":"hi"}"#),
                ("GET /api/v1/fs/search?q=readme HTTP/1.1", r#"{"hits":[]}"#),
                ("GET /api/v1/fs/usage?path=/ HTTP/1.1", r#"{"used":1,"total":2}"#),
                ("GET /api/v1/stock/search?q=desk HTTP/1.1", r#"{"results":[]}"#),
                ("GET /api/v1/sys/update HTTP/1.1", r#"{"available":false}"#),
            ];
            for (expected_line, resp_body) in cases {
                let (mut s, _) = up_listener.accept().unwrap();
                let n = s.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                assert!(req.starts_with(expected_line), "expected {expected_line}, got: {req}");
                assert!(req.contains("Host: mso.example.com\r\n"), "Host not preserved: {req}");
                assert!(req.contains("Cookie: session=r3e-tok\r\n"), "Cookie not preserved: {req}");
                assert!(!req.contains("Authorization:"), "Authorization must not be forwarded: {req}");
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{resp_body}");
                s.write_all(resp.as_bytes()).unwrap();
            }
        });

        let assets = AssetRoot::open(&dir).unwrap();
        let api_origin = Some(parse_loopback_origin(&format!("http://127.0.0.1:{up_port}")).unwrap());
        let mut srv = start_loopback_server(ServerConfig {
            port: 0,
            assets,
            api_origin,
            managed_hosts: ManagedHostConfig::default(),
        })
        .unwrap();

        let send = |raw: &str| {
            let mut c = TcpStream::connect(srv.addr()).unwrap();
            c.write_all(raw.as_bytes()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };

        // Unlisted routes and subpaths MUST return 404 without contacting upstream
        for unlisted in [
            "/api/config",
            "/api/v1/exec/run",
            "/api/v1/editor/exec",
            "/api/v1/shell-apps/extra",
            "/api/v1/camoufox/session/extra",
            "/api/v1/desktop/lifecycle/extra",
            "/api/v1/fs/raw/extra",
            "/api/v1/sys/update/extra",
        ] {
            let r_get = send(&format!("GET {unlisted} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\n\r\n"));
            assert!(r_get.starts_with("HTTP/1.1 404 Not Found") && r_get.contains("not_found"), "GET {unlisted}: {r_get}");
            let r_post = send(&format!("POST {unlisted} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{{}}"));
            assert!(r_post.starts_with("HTTP/1.1 404 Not Found") && r_post.contains("not_found"), "POST {unlisted}: {r_post}");
        }

        // /api/v1/shell-apps: GET + POST (<=65,536 bytes, CSRF depth-2)
        let r = send("GET /api/v1/shell-apps HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\nAuthorization: Bearer strip\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"apps":[]}"#));
        assert!(send("POST /api/v1/shell-apps HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let sa_del = send("DELETE /api/v1/shell-apps HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(sa_del.starts_with("HTTP/1.1 405 Method Not Allowed") && sa_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/shell-apps HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/shell-apps HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\nAuthorization: Bearer strip\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"installed":true}"#));

        // /api/v1/camoufox/service: GET + POST (<=65,536 bytes, CSRF depth-2)
        let r = send("GET /api/v1/camoufox/service HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"running":false}"#));
        assert!(send("POST /api/v1/camoufox/service HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let cs_del = send("DELETE /api/v1/camoufox/service HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(cs_del.starts_with("HTTP/1.1 405 Method Not Allowed") && cs_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/camoufox/service HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/camoufox/service HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"started":true}"#));

        // /api/v1/camoufox/session: GET + POST + DELETE (<=65,536 bytes, CSRF depth-2 on POST & DELETE)
        let r = send("GET /api/v1/camoufox/session HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"sessions":[]}"#));
        assert!(send("POST /api/v1/camoufox/session HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        assert!(send("DELETE /api/v1/camoufox/session?id=cf-1 HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\n\r\n").starts_with("HTTP/1.1 403 Forbidden"));
        let cf_patch = send("PATCH /api/v1/camoufox/session HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(cf_patch.starts_with("HTTP/1.1 405 Method Not Allowed") && cf_patch.contains("Allow: GET, POST, DELETE\r\n"));
        assert!(send("POST /api/v1/camoufox/session HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        assert!(send("DELETE /api/v1/camoufox/session HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r_post = send("POST /api/v1/camoufox/session HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\nAuthorization: Bearer strip\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r_post.starts_with("HTTP/1.1 200 OK") && r_post.contains(r#"{"sessionId":"cf-1"}"#));
        let r_del = send("DELETE /api/v1/camoufox/session?id=cf-1 HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\nAuthorization: Bearer strip\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(r_del.starts_with("HTTP/1.1 200 OK") && r_del.contains(r#"{"closed":true}"#));

        // /api/v1/desktop/containers: GET + POST (<=65,536 bytes, CSRF depth-2)
        let r = send("GET /api/v1/desktop/containers HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"containers":[]}"#));
        assert!(send("POST /api/v1/desktop/containers HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let dc_del = send("DELETE /api/v1/desktop/containers HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\n\r\n");
        assert!(dc_del.starts_with("HTTP/1.1 405 Method Not Allowed") && dc_del.contains("Allow: GET, POST\r\n"));
        assert!(send("POST /api/v1/desktop/containers HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/desktop/containers HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"containerId":"dc-1"}"#));

        // /api/v1/desktop/lifecycle: POST only (<=65,536 bytes, 405 on GET, CSRF depth-2)
        let lc_get = send("GET /api/v1/desktop/lifecycle HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\n\r\n");
        assert!(lc_get.starts_with("HTTP/1.1 405 Method Not Allowed") && lc_get.contains("Allow: POST\r\n"));
        assert!(send("POST /api/v1/desktop/lifecycle HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        assert!(send("POST /api/v1/desktop/lifecycle HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n").starts_with("HTTP/1.1 413 Payload Too Large"));
        let r = send("POST /api/v1/desktop/lifecycle HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\nAuthorization: Bearer strip\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(r#"{"state":"started"}"#));

        // GET-only Stage R3E routes: /api/v1/fs/raw, /api/v1/fs/search, /api/v1/fs/usage, /api/v1/stock/search, /api/v1/sys/update
        for (target, body_fragment) in [
            ("/api/v1/fs/raw?path=notes.txt", r#"{"content":"hi"}"#),
            ("/api/v1/fs/search?q=readme", r#"{"hits":[]}"#),
            ("/api/v1/fs/usage?path=/", r#"{"used":1,"total":2}"#),
            ("/api/v1/stock/search?q=desk", r#"{"results":[]}"#),
            ("/api/v1/sys/update", r#"{"available":false}"#),
        ] {
            let r = send(&format!(
                "GET {target} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3e-tok\r\nAuthorization: Bearer strip\r\n\r\n"
            ));
            assert!(r.starts_with("HTTP/1.1 200 OK") && r.contains(body_fragment), "GET {target}: {r}");
            let path_only = target.split_once('?').map_or(target, |(p, _)| p);
            assert!(send(&format!(
                "POST {path_only} HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{{}}"
            )).starts_with("HTTP/1.1 403 Forbidden"));
            let r_post = send(&format!(
                "POST {path_only} HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{{}}"
            ));
            assert!(r_post.starts_with("HTTP/1.1 405 Method Not Allowed") && r_post.contains("Allow: GET\r\n"), "POST {path_only}: {r_post}");
        }

        up_thread.join().unwrap();
        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforces_stage_r3f_routes_methods_csrf_limits_and_unlisted_guards() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("mso-rust-srv-r3f-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), "<html>ok</html>").unwrap();

        let up_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_port = up_listener.local_addr().unwrap().port();
        let up_thread = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let cases: &[(&str, &str)] = &[
                ("GET /api/v1/desktop/screenshot?id=dc-1 HTTP/1.1", r#"{"image":"base64"}"#),
                ("POST /api/v1/fs/copy HTTP/1.1", r#"{"copied":true}"#),
                ("POST /api/v1/fs/move HTTP/1.1", r#"{"moved":true}"#),
            ];
            for (expected_line, resp_body) in cases {
                let (mut s, _) = up_listener.accept().unwrap();
                let n = s.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                assert!(req.starts_with(expected_line), "expected {expected_line}, got: {req}");
                assert!(req.contains("Host: mso.example.com\r\n"), "Host not preserved: {req}");
                assert!(req.contains("Cookie: session=r3f-tok\r\n"), "Cookie not preserved: {req}");
                assert!(!req.contains("Authorization:"), "Authorization must not be forwarded: {req}");
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{resp_body}");
                s.write_all(resp.as_bytes()).unwrap();
            }
        });

        let assets = AssetRoot::open(&dir).unwrap();
        let api_origin = Some(parse_loopback_origin(&format!("http://127.0.0.1:{up_port}")).unwrap());
        let mut srv = start_loopback_server(ServerConfig {
            port: 0,
            assets,
            api_origin,
            managed_hosts: ManagedHostConfig::default(),
        })
        .unwrap();

        let send = |raw: &str| {
            let mut c = TcpStream::connect(srv.addr()).unwrap();
            c.write_all(raw.as_bytes()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };

        // Unlisted routes and subpaths MUST return 404 without contacting upstream
        for unlisted in [
            "/api/config",
            "/api/v1/exec/run",
            "/api/v1/editor/exec",
            "/api/v1/desktop/screenshot/extra",
            "/api/v1/fs/copy/extra",
            "/api/v1/fs/move/extra",
        ] {
            let r_get = send(&format!("GET {unlisted} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3f-tok\r\n\r\n"));
            assert!(r_get.starts_with("HTTP/1.1 404 Not Found") && r_get.contains("not_found"), "GET {unlisted}: {r_get}");
            let r_post = send(&format!("POST {unlisted} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3f-tok\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{{}}"));
            assert!(r_post.starts_with("HTTP/1.1 404 Not Found") && r_post.contains("not_found"), "POST {unlisted}: {r_post}");
        }

        // /api/v1/desktop/screenshot: GET only (0 bytes, 405 on POST, CSRF depth-2 on cross-site POST)
        let r_ss = send("GET /api/v1/desktop/screenshot?id=dc-1 HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3f-tok\r\nAuthorization: Bearer strip\r\n\r\n");
        assert!(r_ss.starts_with("HTTP/1.1 200 OK") && r_ss.contains(r#"{"image":"base64"}"#));
        assert!(send("POST /api/v1/desktop/screenshot HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{}").starts_with("HTTP/1.1 403 Forbidden"));
        let ss_post = send("POST /api/v1/desktop/screenshot HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 2\r\n\r\n{}");
        assert!(ss_post.starts_with("HTTP/1.1 405 Method Not Allowed") && ss_post.contains("Allow: GET\r\n"));

        // /api/v1/fs/copy & /api/v1/fs/move: POST only (<=65,536 bytes, 405 on GET, CSRF depth-2)
        for (target, body_fragment) in [
            ("/api/v1/fs/copy", r#"{"copied":true}"#),
            ("/api/v1/fs/move", r#"{"moved":true}"#),
        ] {
            let r_get = send(&format!("GET {target} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3f-tok\r\n\r\n"));
            assert!(r_get.starts_with("HTTP/1.1 405 Method Not Allowed") && r_get.contains("Allow: POST\r\n"), "GET {target}: {r_get}");
            assert!(send(&format!("POST {target} HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: cross-site\r\nContent-Length: 2\r\n\r\n{{}}")).starts_with("HTTP/1.1 403 Forbidden"));
            assert!(send(&format!("POST {target} HTTP/1.1\r\nHost: mso.example.com\r\nOrigin: https://evil.example\r\nCookie: session=r3f-tok\r\nContent-Length: 2\r\n\r\n{{}}")).starts_with("HTTP/1.1 403 Forbidden"));
            assert!(send(&format!("POST {target} HTTP/1.1\r\nHost: mso.example.com\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 65537\r\n\r\n")).starts_with("HTTP/1.1 413 Payload Too Large"));
            let r_ok = send(&format!("POST {target} HTTP/1.1\r\nHost: mso.example.com\r\nCookie: session=r3f-tok\r\nAuthorization: Bearer strip\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{{}}"));
            assert!(r_ok.starts_with("HTTP/1.1 200 OK") && r_ok.contains(body_fragment), "POST {target}: {r_ok}");
        }

        up_thread.join().unwrap();
        srv.stop();
        let _ = fs::remove_dir_all(&dir);
    }
}
