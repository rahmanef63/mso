use crate::http::{write_response, MAX_HEADER_BYTES};
use crate::managed::MANAGED_APP_HOST_HEADER;
use crate::origin::HostOrigin;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::Duration;

pub const MAX_ACTIVE_SOCKETS: usize = 32;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
static ACTIVE_SOCKETS: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone)]
pub struct WsUpgradeRequest<'a> {
    pub target: &'a str,
    pub host: Option<&'a str>,
    pub cookie: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub upgrade: Option<&'a str>,
    pub connection: Option<&'a str>,
    pub sec_websocket_key: Option<&'a str>,
    pub sec_websocket_version: Option<&'a str>,
    pub sec_websocket_protocol: Option<&'a str>,
    pub sec_websocket_extensions: Option<&'a str>,
    pub managed_app_host: Option<&'a str>,
    pub client_head: &'a [u8],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WsTunnelOutcome {
    Relayed,
    Rejected(u16),
}

struct SocketSlot;
impl SocketSlot {
    fn acquire() -> Option<Self> {
        let mut cur = ACTIVE_SOCKETS.load(Ordering::Acquire);
        while cur < MAX_ACTIVE_SOCKETS {
            match ACTIVE_SOCKETS.compare_exchange_weak(cur, cur + 1, Ordering::AcqRel, Ordering::Acquire) {
                Ok(_) => return Some(Self),
                Err(next) => cur = next,
            }
        }
        None
    }
}
impl Drop for SocketSlot {
    fn drop(&mut self) {
        ACTIVE_SOCKETS.fetch_sub(1, Ordering::AcqRel);
    }
}

pub fn active_sockets() -> usize {
    ACTIVE_SOCKETS.load(Ordering::Acquire)
}

pub fn is_websocket_upgrade(upgrade_header: Option<&str>) -> bool {
    upgrade_header.is_some_and(|raw| raw.split(',').any(|t| t.trim().eq_ignore_ascii_case("websocket")))
}

pub fn tunnel_websocket(client: &mut TcpStream, upstream: &HostOrigin, req: &WsUpgradeRequest<'_>) -> WsTunnelOutcome {
    let Some(_slot) = SocketSlot::acquire() else { return reject(client, 503, b"socket capacity reached"); };
    if upstream.scheme != "http" || !upstream.is_loopback() { return reject(client, 502, b"upstream unavailable"); }
    if req.target.len() > MAX_HEADER_BYTES || !req.target.starts_with('/') || !is_safe(req.target) {
        return reject(client, 400, b"bad upgrade target");
    }
    let Ok(mut up) = TcpStream::connect(upstream.socket_addr()) else { return reject(client, 502, b"upstream unavailable"); };
    let _ = up.set_read_timeout(Some(HANDSHAKE_TIMEOUT));
    let _ = up.set_write_timeout(Some(HANDSHAKE_TIMEOUT));

    let host = req.host.filter(|h| is_safe(h)).unwrap_or(&upstream.host);
    let mut wire = format!("GET {} HTTP/1.1\r\nHost: {host}\r\n", req.target);
    let headers = [
        ("Cookie", req.cookie),
        ("Origin", req.origin),
        ("Upgrade", req.upgrade.or(Some("websocket"))),
        ("Connection", req.connection.or(Some("Upgrade"))),
        ("Sec-WebSocket-Key", req.sec_websocket_key),
        ("Sec-WebSocket-Version", req.sec_websocket_version),
        ("Sec-WebSocket-Protocol", req.sec_websocket_protocol),
        ("Sec-WebSocket-Extensions", req.sec_websocket_extensions),
        (MANAGED_APP_HOST_HEADER, req.managed_app_host),
    ];
    for (k, v) in headers {
        if let Some(val) = v.filter(|s| is_safe(s)) { wire.push_str(&format!("{k}: {val}\r\n")); }
    }
    wire.push_str("\r\n");
    if up.write_all(wire.as_bytes()).is_err() { return reject(client, 502, b"upstream write failed"); }

    let mut resp = Vec::new();
    let mut buf = [0u8; 2048];
    let sep = loop {
        match up.read(&mut buf) {
            Ok(0) | Err(_) => return reject(client, 502, b"upstream handshake failed"),
            Ok(n) => {
                resp.extend_from_slice(&buf[..n]);
                if let Some(pos) = resp.windows(4).position(|w| w == b"\r\n\r\n") { break pos; }
                if resp.len() > MAX_HEADER_BYTES { return reject(client, 502, b"upstream header too large"); }
            }
        }
    };
    let status = parse_status_code(&resp[..sep]).unwrap_or(502);
    if status != 101 {
        let _ = up.shutdown(Shutdown::Both);
        return reject(client, if (400..=599).contains(&status) { status } else { 502 }, b"upgrade rejected");
    }
    for s in [&*client, &up] { let _ = s.set_read_timeout(None); let _ = s.set_write_timeout(None); }
    if client.write_all(&resp).is_ok() && (req.client_head.is_empty() || up.write_all(req.client_head).is_ok()) {
        if let (Ok(mut cr), Ok(mut uw), Ok(mut ur), Ok(mut cw)) = (client.try_clone(), up.try_clone(), up.try_clone(), client.try_clone()) {
            let h = thread::spawn(move || copy_direction(&mut ur, &mut cw));
            copy_direction(&mut cr, &mut uw);
            let _ = h.join();
        }
    }
    let _ = client.shutdown(Shutdown::Both);
    let _ = up.shutdown(Shutdown::Both);
    WsTunnelOutcome::Relayed
}

fn reject(client: &mut TcpStream, status: u16, msg: &[u8]) -> WsTunnelOutcome {
    let _ = write_response(client, status, "text/plain; charset=utf-8", &[], msg);
    WsTunnelOutcome::Rejected(status)
}
fn is_safe(v: &str) -> bool { !v.is_empty() && !v.contains('\r') && !v.contains('\n') }
fn parse_status_code(head: &[u8]) -> Option<u16> {
    let mut parts = std::str::from_utf8(head).ok()?.split("\r\n").next()?.split_whitespace();
    parts.next()?.starts_with("HTTP/1.").then(|| parts.next()?.parse().ok())?
}
fn copy_direction(src: &mut TcpStream, dst: &mut TcpStream) {
    let mut buf = [0u8; 8192];
    loop {
        match src.read(&mut buf) {
            Ok(0) => { let _ = dst.shutdown(Shutdown::Write); break; }
            Ok(n) if dst.write_all(&buf[..n]).is_ok() => {}
            _ => { let _ = src.shutdown(Shutdown::Both); let _ = dst.shutdown(Shutdown::Both); break; }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::parse_loopback_origin;
    use std::net::TcpListener;

    #[test]
    fn parses_upgrade_tokens_and_tunnels_echo_and_rejection() {
        assert!(is_websocket_upgrade(Some("websocket")) && is_websocket_upgrade(Some("h2c, WebSocket")));
        assert!(!is_websocket_upgrade(Some("mywebsocket")) && !is_websocket_upgrade(None));
        let up_l = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = parse_loopback_origin(&format!("http://127.0.0.1:{}", up_l.local_addr().unwrap().port())).unwrap();
        let up_t = thread::spawn(move || {
            let (mut s, _) = up_l.accept().unwrap();
            let mut buf = [0u8; 2048];
            let n = s.read(&mut buf).unwrap();
            let head = String::from_utf8_lossy(&buf[..n]);
            assert!(head.starts_with("GET /ws/chat HTTP/1.1") && head.contains("x-os-managed-app-host: hermes\r\n"));
            s.write_all(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhello-").unwrap();
            while let Ok(m) = s.read(&mut buf) { if m == 0 { break; } s.write_all(&buf[..m]).unwrap(); }
            drop(s);
            let (mut s2, _) = up_l.accept().unwrap();
            let _ = s2.read(&mut buf);
            s2.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n").unwrap();
        });
        let spawn_tunnel = |orig: HostOrigin, app: Option<&'static str>, head: &'static [u8]| {
            let pl = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = pl.local_addr().unwrap();
            let th = thread::spawn(move || {
                let (mut ss, _) = pl.accept().unwrap();
                tunnel_websocket(&mut ss, &orig, &WsUpgradeRequest {
                    target: "/ws/chat", host: Some("hermes.mso.example.com"), cookie: Some("session=ok"),
                    origin: Some("https://hermes.mso.example.com"), upgrade: Some("websocket"),
                    connection: Some("Upgrade"), sec_websocket_key: Some("dGhlIHNhbXBsZSBub25jZQ=="),
                    sec_websocket_version: Some("13"), sec_websocket_protocol: None,
                    sec_websocket_extensions: None, managed_app_host: app, client_head: head,
                })
            });
            (addr, th)
        };
        let (a1, t1) = spawn_tunnel(origin.clone(), Some("hermes"), b"ping!");
        let mut c1 = TcpStream::connect(a1).unwrap();
        c1.write_all(b"pong!").unwrap();
        c1.shutdown(Shutdown::Write).unwrap();
        let mut r1 = Vec::new();
        c1.read_to_end(&mut r1).unwrap();
        drop(c1);
        assert!(String::from_utf8_lossy(&r1).starts_with("HTTP/1.1 101") && String::from_utf8_lossy(&r1).ends_with("hello-ping!pong!"));
        assert_eq!(t1.join().unwrap(), WsTunnelOutcome::Relayed);
        let (a2, t2) = spawn_tunnel(origin, None, b"");
        let mut r2 = String::new();
        TcpStream::connect(a2).unwrap().read_to_string(&mut r2).unwrap();
        assert!(r2.starts_with("HTTP/1.1 403 Forbidden") && t2.join().unwrap() == WsTunnelOutcome::Rejected(403));
        up_t.join().unwrap();
        assert_eq!(active_sockets(), 0);
    }
}
