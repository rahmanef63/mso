use mso_shell_core::desktop::{render_bridge_bootstrap_json, DesktopHostProfile};
use std::fmt;

pub const MAX_HOST_PROFILES: usize = 16;
pub const DEFAULT_LOCAL_PROFILE_ID: &str = "local-default";
pub const DEFAULT_LOCAL_PROFILE_LABEL: &str = "Local MSO Host (WSL2/Lima)";
pub const DEFAULT_LOCAL_HOST_ORIGIN: &str = "http://127.0.0.1:4005";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileStoreError {
    CapacityExceeded { max: usize },
    ProfileNotFound(String),
    CannotRemoveLastProfile,
}

impl fmt::Display for ProfileStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CapacityExceeded { max } => {
                write!(f, "host profile limit exceeded (max {max})")
            }
            Self::ProfileNotFound(id) => write!(f, "host profile not found: {id}"),
            Self::CannotRemoveLastProfile => {
                f.write_str("cannot remove the last active host profile")
            }
        }
    }
}

impl std::error::Error for ProfileStoreError {}

/// Bounded multi-profile registry for the MSO native desktop shell.
///
/// Always retains at least one validated `DesktopHostProfile` (defaulting to the
/// local WSL2/Lima loopback host) and caps entries at `MAX_HOST_PROFILES` (16).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostProfileStore {
    profiles: Vec<DesktopHostProfile>,
    active_id: String,
}

impl HostProfileStore {
    /// Creates a store initialized with the default local loopback host profile.
    pub fn default_local() -> Self {
        let local = DesktopHostProfile::new(
            DEFAULT_LOCAL_PROFILE_ID,
            DEFAULT_LOCAL_PROFILE_LABEL,
            DEFAULT_LOCAL_HOST_ORIGIN,
            true,
        )
        .expect("default local desktop host profile must be valid");
        Self {
            active_id: local.id.clone(),
            profiles: vec![local],
        }
    }

    /// Inserts a new validated profile or updates an existing profile with the same `id`.
    pub fn upsert(&mut self, profile: DesktopHostProfile) -> Result<(), ProfileStoreError> {
        if let Some(existing) = self.profiles.iter_mut().find(|item| item.id == profile.id) {
            *existing = profile;
            return Ok(());
        }
        if self.profiles.len() >= MAX_HOST_PROFILES {
            return Err(ProfileStoreError::CapacityExceeded {
                max: MAX_HOST_PROFILES,
            });
        }
        self.profiles.push(profile);
        Ok(())
    }

    /// Removes a profile by `id`. Fails if `id` is missing or if it is the last profile.
    /// When removing the currently active profile and another remains, promotes the first
    /// remaining profile so `active()` stays valid.
    #[allow(dead_code)]
    pub fn remove(&mut self, id: &str) -> Result<DesktopHostProfile, ProfileStoreError> {
        let Some(idx) = self.profiles.iter().position(|item| item.id == id) else {
            return Err(ProfileStoreError::ProfileNotFound(id.to_string()));
        };
        if self.profiles.len() <= 1 {
            return Err(ProfileStoreError::CannotRemoveLastProfile);
        }
        let removed = self.profiles.remove(idx);
        if self.active_id == id {
            self.active_id = self.profiles[0].id.clone();
        }
        Ok(removed)
    }

    /// Marks the profile matching `id` as active.
    pub fn select(&mut self, id: &str) -> Result<&DesktopHostProfile, ProfileStoreError> {
        let Some(idx) = self.profiles.iter().position(|item| item.id == id) else {
            return Err(ProfileStoreError::ProfileNotFound(id.to_string()));
        };
        self.active_id = self.profiles[idx].id.clone();
        Ok(&self.profiles[idx])
    }

    /// Returns the currently active host profile.
    pub fn active(&self) -> &DesktopHostProfile {
        self.profiles
            .iter()
            .find(|item| item.id == self.active_id)
            .unwrap_or(&self.profiles[0])
    }

    #[allow(dead_code)]
    pub fn profiles(&self) -> &[DesktopHostProfile] {
        &self.profiles
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.profiles.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.profiles.is_empty()
    }

    /// Renders the active profile bootstrap payload via `render_bridge_bootstrap_json`.
    pub fn active_bootstrap_json(&self, shell_version: &str) -> String {
        render_bridge_bootstrap_json(self.active(), shell_version)
    }

    /// Serializes the active profile, capacity, and full profile list as JSON using
    /// `mso_shell_core::desktop::render_bridge_bootstrap_json`.
    pub fn to_json(&self, shell_version: &str) -> String {
        let active = self.active();
        let mut out = String::from("{");
        out.push_str(r#""activeProfileId":""#);
        out.push_str(&escape_json_str(&active.id));
        out.push_str(r#"","maxProfiles":"#);
        out.push_str(&MAX_HOST_PROFILES.to_string());
        out.push_str(r#","activeBootstrap":"#);
        out.push_str(&self.active_bootstrap_json(shell_version));
        out.push_str(r#","profiles":["#);

        for (index, profile) in self.profiles.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            let is_active = profile.id == active.id;
            let bootstrap = render_bridge_bootstrap_json(profile, shell_version);
            out.push_str(r#"{"id":""#);
            out.push_str(&escape_json_str(&profile.id));
            out.push_str(r#"","label":""#);
            out.push_str(&escape_json_str(&profile.label));
            out.push_str(r#"","apiBaseOrigin":""#);
            out.push_str(&escape_json_str(&profile.api_base_origin()));
            out.push_str(r#"","isLocal":"#);
            out.push_str(if profile.is_local { "true" } else { "false" });
            out.push_str(r#","active":"#);
            out.push_str(if is_active { "true" } else { "false" });
            out.push_str(r#","bootstrap":"#);
            out.push_str(&bootstrap);
            out.push('}');
        }

        out.push_str("]}");
        out
    }
}

fn escape_json_str(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\x08' => out.push_str("\\b"),
            '\x0c' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '<' => out.push_str("\\u003c"),
            '>' => out.push_str("\\u003e"),
            '&' => out.push_str("\\u0026"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c if (c as u32) < 0x20 || c == '\x7f' => {
                use std::fmt::Write as _;
                let _ = write!(&mut out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote_profile(id: &str, label: &str, origin: &str) -> DesktopHostProfile {
        DesktopHostProfile::new(id, label, origin, false).expect("valid remote profile")
    }

    #[test]
    fn default_local_initializes_loopback_active_profile() {
        let store = HostProfileStore::default_local();
        assert_eq!(store.len(), 1);
        assert!(!store.is_empty());
        assert_eq!(store.active().id, DEFAULT_LOCAL_PROFILE_ID);
        assert!(store.active().is_local);
        assert_eq!(store.active().api_base_origin(), DEFAULT_LOCAL_HOST_ORIGIN);
    }

    #[test]
    fn upserts_updates_in_place_and_enforces_max_capacity() {
        let mut store = HostProfileStore::default_local();
        for idx in 1..MAX_HOST_PROFILES {
            let id = format!("remote-{idx}");
            let label = format!("Remote Host {idx}");
            let origin = format!("https://host-{idx}.mso.example.com");
            store
                .upsert(remote_profile(&id, &label, &origin))
                .expect("within capacity");
        }
        assert_eq!(store.len(), MAX_HOST_PROFILES);

        // Updating an existing entry succeeds even at full capacity.
        store
            .upsert(remote_profile(
                "remote-1",
                "Remote Host 1 Updated",
                "https://updated.mso.example.com:8443",
            ))
            .expect("in-place update at capacity should succeed");
        assert_eq!(store.len(), MAX_HOST_PROFILES);
        let updated = store
            .profiles()
            .iter()
            .find(|p| p.id == "remote-1")
            .expect("updated profile exists");
        assert_eq!(updated.label, "Remote Host 1 Updated");
        assert_eq!(
            updated.api_base_origin(),
            "https://updated.mso.example.com:8443"
        );

        // Inserting a 17th distinct profile fails closed with CapacityExceeded.
        assert_eq!(
            store.upsert(remote_profile(
                "overflow-17",
                "Overflow",
                "https://overflow.mso.example.com",
            )),
            Err(ProfileStoreError::CapacityExceeded {
                max: MAX_HOST_PROFILES,
            })
        );
    }

    #[test]
    fn select_and_remove_preserve_active_profile_invariant() {
        let mut store = HostProfileStore::default_local();

        // Cannot remove the only active profile.
        assert_eq!(
            store.remove(DEFAULT_LOCAL_PROFILE_ID),
            Err(ProfileStoreError::CannotRemoveLastProfile)
        );
        assert_eq!(
            store.remove("missing"),
            Err(ProfileStoreError::ProfileNotFound("missing".to_string()))
        );
        assert_eq!(
            store.select("missing"),
            Err(ProfileStoreError::ProfileNotFound("missing".to_string()))
        );

        store
            .upsert(remote_profile(
                "prod-vps",
                "Production VPS",
                "https://mso.example.com",
            ))
            .unwrap();
        let selected = store.select("prod-vps").expect("select remote");
        assert_eq!(selected.id, "prod-vps");
        assert_eq!(store.active().api_base_origin(), "https://mso.example.com");

        // Removing the active profile promotes the first remaining profile.
        let removed = store.remove("prod-vps").expect("remove active remote");
        assert_eq!(removed.id, "prod-vps");
        assert_eq!(store.len(), 1);
        assert_eq!(store.active().id, DEFAULT_LOCAL_PROFILE_ID);

        // Cannot remove the last remaining profile after removal.
        assert_eq!(
            store.remove(DEFAULT_LOCAL_PROFILE_ID),
            Err(ProfileStoreError::CannotRemoveLastProfile)
        );
    }

    #[test]
    fn serializes_profiles_and_bootstrap_json_safely() {
        let mut store = HostProfileStore::default_local();
        store
            .upsert(remote_profile(
                "prod-eu",
                "Prod \"EU\" <Primary> & Team",
                "https://mso.example.com:8443",
            ))
            .unwrap();
        store.select("prod-eu").unwrap();

        let json = store.to_json("0.1.0");
        assert!(json.contains(r#""activeProfileId":"prod-eu""#));
        assert!(json.contains(r#""maxProfiles":16"#));
        assert!(json.contains(
            r#""activeBootstrap":{"mode":"tauri-desktop","apiBaseOrigin":"https://mso.example.com:8443","profileId":"prod-eu","shellVersion":"0.1.0"}"#
        ));
        assert!(json.contains(
            r#""label":"Prod \"EU\" \u003cPrimary\u003e \u0026 Team""#
        ));
        assert!(json.contains(r#""id":"local-default""#));
        assert!(json.contains(r#""isLocal":true,"active":false"#));
        assert!(json.contains(r#""isLocal":false,"active":true"#));
    }
}
