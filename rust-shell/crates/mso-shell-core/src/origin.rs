use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostOrigin {
    pub scheme: String,
    pub host: String,
    pub port: u16,
}

impl HostOrigin {
    pub fn socket_addr(&self) -> String {
        let bare_host = self.host.trim_start_matches('[').trim_end_matches(']');
        if bare_host.contains(':') {
            format!("[{}]:{}", bare_host, self.port)
        } else {
            format!("{}:{}", bare_host, self.port)
        }
    }

    pub fn is_loopback(&self) -> bool {
        is_loopback_host(&self.host)
    }

    pub fn as_origin_string(&self) -> String {
        let default_port = if self.scheme == "https" { 443 } else { 80 };
        if self.port == default_port {
            format!("{}://{}", self.scheme, self.host)
        } else {
            format!("{}://{}:{}", self.scheme, self.host, self.port)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OriginError {
    Empty,
    ControlCharacters,
    InvalidScheme,
    CredentialsDisallowed,
    PathOrQueryDisallowed,
    InvalidHost,
    InvalidPort,
    LoopbackRequired,
    HttpsRequiredForRemote,
}

impl fmt::Display for OriginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let msg = match self {
            Self::Empty => "origin must not be empty",
            Self::ControlCharacters => "origin contains control or whitespace characters",
            Self::InvalidScheme => "origin scheme must be http or https",
            Self::CredentialsDisallowed => "origin must not contain userinfo credentials",
            Self::PathOrQueryDisallowed => "origin must not include a path, query, or fragment",
            Self::InvalidHost => "origin host is invalid",
            Self::InvalidPort => "origin port must be 1..=65535",
            Self::LoopbackRequired => "origin host must be explicit loopback (127.0.0.1, [::1], or localhost)",
            Self::HttpsRequiredForRemote => "remote host origins must use https",
        };
        f.write_str(msg)
    }
}

impl std::error::Error for OriginError {}

fn is_loopback_host(host: &str) -> bool {
    matches!(host.to_ascii_lowercase().as_str(), "127.0.0.1" | "[::1]" | "localhost")
}

fn parse_origin_common(raw: &str) -> Result<HostOrigin, OriginError> {
    if raw.is_empty() {
        return Err(OriginError::Empty);
    }
    if raw.bytes().any(|b| b <= 0x20 || b == 0x7f) {
        return Err(OriginError::ControlCharacters);
    }
    let (scheme, rest) = raw.split_once("://").ok_or(OriginError::InvalidScheme)?;
    let scheme_lower = scheme.to_ascii_lowercase();
    if scheme_lower != "http" && scheme_lower != "https" {
        return Err(OriginError::InvalidScheme);
    }
    if rest.contains('?') || rest.contains('#') {
        return Err(OriginError::PathOrQueryDisallowed);
    }
    let authority = match rest.split_once('/') {
        Some((auth, "")) => auth,
        Some(_) => return Err(OriginError::PathOrQueryDisallowed),
        None => rest,
    };
    if authority.is_empty() {
        return Err(OriginError::InvalidHost);
    }
    if authority.contains('@') {
        return Err(OriginError::CredentialsDisallowed);
    }

    let (host, port_opt) = if let Some(after_open) = authority.strip_prefix('[') {
        let (ipv6, tail) = after_open.split_once(']').ok_or(OriginError::InvalidHost)?;
        if ipv6.is_empty() || !ipv6.bytes().all(|b| b.is_ascii_hexdigit() || b == b':') {
            return Err(OriginError::InvalidHost);
        }
        let port_part = if tail.is_empty() {
            None
        } else if let Some(p) = tail.strip_prefix(':') {
            Some(p)
        } else {
            return Err(OriginError::InvalidHost);
        };
        (format!("[{}]", ipv6.to_ascii_lowercase()), port_part)
    } else if let Some((h, p)) = authority.rsplit_once(':') {
        if h.contains(':') {
            return Err(OriginError::InvalidHost);
        }
        (h.to_ascii_lowercase(), Some(p))
    } else {
        (authority.to_ascii_lowercase(), None)
    };

    if host.is_empty() || !host.starts_with('[') && !valid_hostname(&host) {
        return Err(OriginError::InvalidHost);
    }

    let port = match port_opt {
        None => if scheme_lower == "https" { 443 } else { 80 },
        Some(p) => {
            if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
                return Err(OriginError::InvalidPort);
            }
            let parsed: u16 = p.parse().map_err(|_| OriginError::InvalidPort)?;
            if parsed == 0 {
                return Err(OriginError::InvalidPort);
            }
            parsed
        }
    };

    Ok(HostOrigin { scheme: scheme_lower, host, port })
}

fn valid_hostname(host: &str) -> bool {
    if host.starts_with('.') || host.ends_with('.') || host.contains("..") {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

pub fn parse_loopback_origin(raw: &str) -> Result<HostOrigin, OriginError> {
    let origin = parse_origin_common(raw)?;
    if !origin.is_loopback() {
        return Err(OriginError::LoopbackRequired);
    }
    Ok(origin)
}

pub fn parse_remote_origin(raw: &str) -> Result<HostOrigin, OriginError> {
    let origin = parse_origin_common(raw)?;
    if origin.scheme != "https" && !origin.is_loopback() {
        return Err(OriginError::HttpsRequiredForRemote);
    }
    Ok(origin)
}

pub fn validate_loopback_origin(raw: &str) -> Result<HostOrigin, OriginError> {
    parse_loopback_origin(raw)
}

pub fn validate_remote_host_origin(raw: &str) -> Result<HostOrigin, OriginError> {
    parse_remote_origin(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_loopback_origins() {
        let a = parse_loopback_origin("http://127.0.0.1:4005").unwrap();
        assert_eq!(a.socket_addr(), "127.0.0.1:4005");
        assert_eq!(a.as_origin_string(), "http://127.0.0.1:4005");

        let b = parse_loopback_origin("http://localhost:4005/").unwrap();
        assert_eq!(b.host, "localhost");
        assert_eq!(b.port, 4005);

        let c = parse_loopback_origin("https://[::1]:8443").unwrap();
        assert_eq!(c.socket_addr(), "[::1]:8443");
    }

    #[test]
    fn rejects_non_loopback_or_malformed_loopback_origins() {
        for bad in [
            "",
            "http://mso.example.com",
            "https://mso.example.com",
            "http://10.0.0.5:4005",
            "http://user:pass@127.0.0.1:4005",
            "http://127.0.0.1:4005/api",
            "http://127.0.0.1:4005/?a=1",
            "http://127.0.0.1:4005/#hash",
            "http://127.0.0.1:0",
            "http://127.0.0.1:4005\r\nX-Injected: 1",
            "file:///etc/passwd",
        ] {
            assert!(parse_loopback_origin(bad).is_err(), "expected error for {bad}");
        }
    }

    #[test]
    fn remote_origin_requires_https_outside_loopback() {
        assert!(parse_remote_origin("https://mso.example.com").is_ok());
        assert!(parse_remote_origin("http://127.0.0.1:4005").is_ok());
        assert_eq!(
            parse_remote_origin("http://mso.example.com"),
            Err(OriginError::HttpsRequiredForRemote)
        );
        assert!(validate_loopback_origin("http://127.0.0.1:4005").is_ok());
        assert_eq!(
            validate_loopback_origin("https://mso.example.com"),
            Err(OriginError::LoopbackRequired)
        );
        assert!(validate_remote_host_origin("https://mso.example.com:8443").is_ok());
        assert_eq!(
            validate_remote_host_origin("http://mso.example.com"),
            Err(OriginError::HttpsRequiredForRemote)
        );
    }
}
