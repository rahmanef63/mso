pub const MANAGED_APP_HOST_HEADER: &str = "x-os-managed-app-host";
pub const MANAGED_APP_IDS: &[&str] = &["hermes", "openclaw", "9router", "orca", "t3"];
const TOKEN: &str = "{id}";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostClass {
    Cockpit,
    ManagedApp(String),
    UnclaimedAppNamespace,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedHostConfig {
    template: Option<String>,
    app_ids: Vec<String>,
}

impl Default for ManagedHostConfig {
    fn default() -> Self {
        Self::from_template(None)
    }
}

impl ManagedHostConfig {
    pub fn from_template(template: Option<&str>) -> Self {
        let parsed = template
            .map(str::trim)
            .filter(|t| !t.is_empty() && t.contains(TOKEN))
            .map(ToString::to_string);
        Self {
            template: parsed,
            app_ids: MANAGED_APP_IDS.iter().map(|id| (*id).to_string()).collect(),
        }
    }

    pub fn split_origin_enabled(&self) -> bool {
        self.template.is_some()
    }

    pub fn managed_app_host(&self, id: &str) -> Option<String> {
        let tpl = self.template.as_deref()?;
        is_valid_namespace_label(id).then(|| tpl.replacen(TOKEN, id, 1).to_ascii_lowercase())
    }

    pub fn managed_app_id_for_host(&self, host: Option<&str>) -> Option<String> {
        if !self.split_origin_enabled() {
            return None;
        }
        let bare = bare_host(host?);
        if bare.is_empty() {
            return None;
        }
        self.app_ids
            .iter()
            .find(|id| self.managed_app_host(id).as_deref() == Some(bare.as_str()))
            .cloned()
    }

    fn template_parent(&self) -> Option<String> {
        let tpl = self.template.as_deref()?;
        let tail = &tpl[tpl.find(TOKEN)? + TOKEN.len()..];
        let parent = tail.trim_start_matches(|c| c == '.' || c == '-').to_ascii_lowercase();
        parent.contains('.').then_some(parent)
    }

    pub fn is_unclaimed_app_namespace_host(&self, host: Option<&str>) -> bool {
        let (Some(parent), Some(raw)) = (self.template_parent(), host) else {
            return false;
        };
        let bare = bare_host(raw);
        !bare.is_empty()
            && bare.ends_with(&format!(".{parent}"))
            && self.managed_app_id_for_host(Some(&bare)).is_none()
    }

    pub fn classify_host(&self, host: Option<&str>) -> HostClass {
        if let Some(id) = self.managed_app_id_for_host(host) {
            HostClass::ManagedApp(id)
        } else if self.is_unclaimed_app_namespace_host(host) {
            HostClass::UnclaimedAppNamespace
        } else {
            HostClass::Cockpit
        }
    }
}

pub fn is_blocked_managed_path(target: &str) -> bool {
    let path = target.split_once('?').map_or(target, |(p, _)| p);
    path == "/_next" || path.starts_with("/_next/")
}

pub fn managed_app_proxy_target(app_id: &str, target: &str) -> String {
    let (path, query) = target.split_once('?').map_or((target, None), |(p, q)| (p, Some(q)));
    let trimmed = path.trim_end_matches('/');
    match query {
        Some(q) => format!("/api/v1/managed-apps/{app_id}/proxy{trimmed}?{q}"),
        None => format!("/api/v1/managed-apps/{app_id}/proxy{trimmed}"),
    }
}

pub fn is_machine_protocol_path(target: &str) -> bool {
    let path = target.split_once('?').map_or(target, |(p, _)| p);
    path == "/mcp"
        || path.starts_with("/.well-known/oauth-")
        || path == "/oauth/token"
        || path == "/oauth/register"
        || path == "/a2a/v1"
        || path == "/.well-known/agent-card.json"
}

fn bare_host(host: &str) -> String {
    let trimmed = host.trim();
    let no_port = if trimmed.starts_with('[') {
        trimmed.split(']').next().unwrap_or(trimmed)
    } else {
        trimmed.split(':').next().unwrap_or(trimmed)
    };
    no_port.strip_suffix('.').unwrap_or(no_port).to_ascii_lowercase()
}

fn is_valid_namespace_label(label: &str) -> bool {
    let b = label.as_bytes();
    let is_alnum = |c: u8| c.is_ascii_lowercase() || c.is_ascii_digit();
    !b.is_empty()
        && b.len() <= 63
        && is_alnum(b[0])
        && is_alnum(b[b.len() - 1])
        && b.iter().all(|&c| is_alnum(c) || c == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_managed_unclaimed_and_cockpit_hosts() {
        let cfg = ManagedHostConfig::from_template(Some("{id}.mso.example.com"));
        assert!(cfg.split_origin_enabled());
        for id in MANAGED_APP_IDS {
            assert_eq!(
                cfg.classify_host(Some(&format!("{id}.mso.example.com"))),
                HostClass::ManagedApp((*id).into())
            );
        }
        assert_eq!(cfg.classify_host(Some("HERMES.MSO.EXAMPLE.COM.:443")), HostClass::ManagedApp("hermes".into()));
        assert_eq!(cfg.classify_host(Some("staging.mso.example.com")), HostClass::UnclaimedAppNamespace);
        assert_eq!(cfg.classify_host(Some("a.b.mso.example.com:8443")), HostClass::UnclaimedAppNamespace);
        assert_eq!(cfg.classify_host(Some("mso.example.com")), HostClass::Cockpit);
        assert_eq!(cfg.classify_host(Some("127.0.0.1:4174")), HostClass::Cockpit);
        assert_eq!(cfg.classify_host(None), HostClass::Cockpit);
    }

    #[test]
    fn disabled_or_single_label_template_never_claims_hosts() {
        let disabled = ManagedHostConfig::default();
        assert!(!disabled.split_origin_enabled());
        assert_eq!(disabled.classify_host(Some("hermes.mso.example.com")), HostClass::Cockpit);
        assert!(!disabled.is_unclaimed_app_namespace_host(Some("staging.mso.example.com")));
        assert!(!ManagedHostConfig::from_template(Some("mso.example.com")).split_origin_enabled());
        assert!(!ManagedHostConfig::from_template(Some("{id}.com")).is_unclaimed_app_namespace_host(Some("x.com")));
    }

    #[test]
    fn identifies_machine_protocol_and_managed_proxy_paths() {
        for p in [
            "/mcp",
            "/mcp?session=1",
            "/.well-known/oauth-authorization-server",
            "/.well-known/oauth-protected-resource",
            "/oauth/token",
            "/oauth/register",
            "/a2a/v1",
            "/.well-known/agent-card.json",
        ] {
            assert!(is_machine_protocol_path(p), "expected machine protocol: {p}");
        }
        for p in ["/oauth/authorize", "/api/v1/a2a", "/api/auth/me", "/", "/mcp/extra"] {
            assert!(!is_machine_protocol_path(p), "unexpected machine protocol: {p}");
        }
        assert!(is_blocked_managed_path("/_next") && is_blocked_managed_path("/_next/static/a.js"));
        assert!(!is_blocked_managed_path("/next/app"));
        assert_eq!(managed_app_proxy_target("hermes", "/"), "/api/v1/managed-apps/hermes/proxy");
        assert_eq!(managed_app_proxy_target("hermes", "/chat/?ticket=1"), "/api/v1/managed-apps/hermes/proxy/chat?ticket=1");
    }
}
