#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use mso_shell_core::desktop::{
    parse_deep_link, render_bridge_bootstrap_json, DesktopError, DesktopHostProfile,
};
use mso_shell_core::origin::OriginError;
use tauri::Manager;

const DEFAULT_HOST_ORIGIN: &str = "http://127.0.0.1:4005";
const HOST_ORIGIN_ENV: &str = "MSO_DESKTOP_HOST_ORIGIN";
const SHELL_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Resolves the active MSO host profile from `MSO_DESKTOP_HOST_ORIGIN`.
///
/// - Unset or blank defaults to local loopback (`http://127.0.0.1:4005`).
/// - Explicit loopback origins (`127.0.0.1`, `localhost`, `[::1]`) allow HTTP or HTTPS.
/// - Non-loopback origins require HTTPS; plaintext remote HTTP is rejected fail-closed.
fn resolve_host_profile(raw_origin: Option<&str>) -> Result<DesktopHostProfile, String> {
    let trimmed = raw_origin.map(str::trim).filter(|value| !value.is_empty());
    let Some(origin) = trimmed else {
        return DesktopHostProfile::new(
            "local-default",
            "Local MSO Host",
            DEFAULT_HOST_ORIGIN,
            true,
        )
        .map_err(|err| format!("invalid default desktop host origin: {err}"));
    };

    match DesktopHostProfile::new("local-env", "Local MSO Host", origin, true) {
        Ok(profile) => Ok(profile),
        Err(DesktopError::InvalidOrigin(OriginError::LoopbackRequired)) => {
            DesktopHostProfile::new("remote-env", "Remote MSO Host", origin, false).map_err(
                |err| {
                    format!(
                        "invalid {HOST_ORIGIN_ENV} value: {err} (remote hosts require https://)"
                    )
                },
            )
        }
        Err(err) => Err(format!("invalid {HOST_ORIGIN_ENV} value: {err}")),
    }
}

/// Builds the WebView initialization script injecting `window.__MSO_DESKTOP_SHELL__`
/// from `mso_shell_core::desktop::render_bridge_bootstrap_json` and mirroring the narrow
/// `window.__MSO_SHELL__` bridge read by `frontend/svelte/src/lib/shell-bridge.ts`.
fn build_initialization_script(profile: &DesktopHostProfile, shell_version: &str) -> String {
    let bootstrap_json = render_bridge_bootstrap_json(profile, shell_version);
    format!(
        r#"(function () {{
  var loc = window.location;
  var isBundled = loc.protocol === "tauri:" || loc.hostname === "tauri.localhost";
  var isLoopback = loc.hostname === "127.0.0.1" || loc.hostname === "localhost" || loc.hostname === "[::1]" || loc.hostname === "::1";
  if (!isBundled && !isLoopback) {{
    return;
  }}
  var bootstrap = Object.freeze({bootstrap_json});
  if (!Object.prototype.hasOwnProperty.call(window, "__MSO_DESKTOP_SHELL__")) {{
    Object.defineProperty(window, "__MSO_DESKTOP_SHELL__", {{
      value: bootstrap,
      writable: false,
      configurable: false
    }});
  }}
  if (!Object.prototype.hasOwnProperty.call(window, "__MSO_SHELL__")) {{
    Object.defineProperty(window, "__MSO_SHELL__", {{
      value: Object.freeze({{
        surface: bootstrap.mode,
        apiBaseOrigin: bootstrap.apiBaseOrigin
      }}),
      writable: false,
      configurable: false
    }});
  }}
}})();"#,
    )
}

/// Validates and normalizes an `mso://open/<slug>[?path=<rel>]` deep link into an
/// app-relative route via `mso_shell_core::desktop::parse_deep_link`.
#[tauri::command]
fn resolve_deep_link(uri: String) -> Result<String, String> {
    parse_deep_link(&uri).map_err(|err| err.to_string())
}

fn main() {
    let raw_env = std::env::var(HOST_ORIGIN_ENV).ok();
    let profile = match resolve_host_profile(raw_env.as_deref()) {
        Ok(profile) => profile,
        Err(err) => {
            eprintln!("mso-desktop-tauri startup rejected: {err}");
            std::process::exit(2);
        }
    };
    let init_script = build_initialization_script(&profile, SHELL_VERSION);

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![resolve_deep_link])
        .setup(move |app| {
            let window_config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "missing main window definition in tauri.conf.json",
                    )
                })?;

            tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                .initialization_script(init_script)
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MSO desktop shell");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_loopback_origin_when_env_unset_or_blank() {
        for raw in [None, Some(""), Some("   ")] {
            let profile = resolve_host_profile(raw).expect("default profile should succeed");
            assert_eq!(profile.id, "local-default");
            assert!(profile.is_local);
            assert_eq!(profile.api_base_origin(), DEFAULT_HOST_ORIGIN);
        }
    }

    #[test]
    fn accepts_explicit_loopback_and_remote_https_origins() {
        let local = resolve_host_profile(Some("http://localhost:4005"))
            .expect("loopback http origin should succeed");
        assert_eq!(local.id, "local-env");
        assert!(local.is_local);
        assert_eq!(local.api_base_origin(), "http://localhost:4005");

        let remote = resolve_host_profile(Some("https://mso.example.com:8443"))
            .expect("remote https origin should succeed");
        assert_eq!(remote.id, "remote-env");
        assert!(!remote.is_local);
        assert_eq!(remote.api_base_origin(), "https://mso.example.com:8443");
    }

    #[test]
    fn rejects_plaintext_remote_http_and_malformed_origins() {
        for bad in [
            "http://mso.example.com",
            "http://user:pass@127.0.0.1:4005",
            "https://mso.example.com/api",
            "javascript:alert(1)",
        ] {
            assert!(
                resolve_host_profile(Some(bad)).is_err(),
                "expected origin rejection for {bad}"
            );
        }
    }

    #[test]
    fn renders_init_script_with_desktop_and_shell_bridge_globals() {
        let profile = resolve_host_profile(Some("https://mso.example.com")).unwrap();
        let script = build_initialization_script(&profile, "0.1.0");
        assert!(script.contains("__MSO_DESKTOP_SHELL__"));
        assert!(script.contains("__MSO_SHELL__"));
        assert!(script.contains(r#""mode":"tauri-desktop""#));
        assert!(script.contains(r#""apiBaseOrigin":"https://mso.example.com""#));
    }

    #[test]
    fn resolve_deep_link_delegates_to_core_parser() {
        assert_eq!(
            resolve_deep_link("mso://open/files".to_string()).unwrap(),
            "/files"
        );
        assert_eq!(
            resolve_deep_link("mso://open/editor?path=src/lib/app.ts".to_string()).unwrap(),
            "/editor?path=src/lib/app.ts"
        );
        assert!(resolve_deep_link("mso://open/api/auth/me".to_string()).is_err());
        assert!(resolve_deep_link("mso://open/files?path=../etc/passwd".to_string()).is_err());
        assert!(resolve_deep_link("https://mso.example.com/files".to_string()).is_err());
    }
}
