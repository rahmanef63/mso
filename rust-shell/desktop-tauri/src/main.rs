#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod profiles;

use mso_shell_core::apple_shell::{resolve_device_mode, ShellKind, APPLE_DEVICES, CHROME_GEOMETRY};
use mso_shell_core::desktop::{
    parse_deep_link, render_bridge_bootstrap_json, DesktopError, DesktopHostProfile,
};
use mso_shell_core::origin::OriginError;
use profiles::{
    HostProfileStore, DEFAULT_LOCAL_HOST_ORIGIN, DEFAULT_LOCAL_PROFILE_ID,
    DEFAULT_LOCAL_PROFILE_LABEL,
};
use std::sync::Mutex;
use tauri::Manager;

const DEFAULT_HOST_ORIGIN: &str = DEFAULT_LOCAL_HOST_ORIGIN;
const HOST_ORIGIN_ENV: &str = "MSO_DESKTOP_HOST_ORIGIN";
const SHELL_VERSION: &str = env!("CARGO_PKG_VERSION");

struct DesktopProfilesState(Mutex<HostProfileStore>);

/// Resolves the active MSO host profile from `MSO_DESKTOP_HOST_ORIGIN`.
///
/// - Unset or blank defaults to local loopback (`http://127.0.0.1:4005`).
/// - Explicit loopback origins (`127.0.0.1`, `localhost`, `[::1]`) allow HTTP or HTTPS.
/// - Non-loopback origins require HTTPS; plaintext remote HTTP is rejected fail-closed.
fn resolve_host_profile(raw_origin: Option<&str>) -> Result<DesktopHostProfile, String> {
    let trimmed = raw_origin.map(str::trim).filter(|value| !value.is_empty());
    let Some(origin) = trimmed else {
        return DesktopHostProfile::new(
            DEFAULT_LOCAL_PROFILE_ID,
            DEFAULT_LOCAL_PROFILE_LABEL,
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

/// Initializes the bounded `HostProfileStore` with the local WSL2/Lima default profile
/// and registers/selects any validated host override from `MSO_DESKTOP_HOST_ORIGIN`.
fn build_initial_profile_store(raw_origin: Option<&str>) -> Result<HostProfileStore, String> {
    let mut store = HostProfileStore::default_local();
    let resolved = resolve_host_profile(raw_origin)?;
    let active_id = resolved.id.clone();
    store
        .upsert(resolved)
        .map_err(|err| format!("failed to register desktop host profile: {err}"))?;
    store
        .select(&active_id)
        .map_err(|err| format!("failed to select desktop host profile: {err}"))?;
    Ok(store)
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

/// Returns the active host profile and bounded multi-profile registry as JSON.
#[tauri::command]
fn list_host_profiles_json(
    state: tauri::State<'_, DesktopProfilesState>,
) -> Result<String, String> {
    let store = state
        .0
        .lock()
        .map_err(|_| "desktop host profile store lock poisoned".to_string())?;
    Ok(store.to_json(SHELL_VERSION))
}

/// Largest frame among registry devices rendered with the desktop shell.
///
/// The macOS window must never be smaller than that frame, otherwise bezel and
/// toolbar chrome overflow the viewport.
fn desktop_frame_floor() -> (u32, u32) {
    APPLE_DEVICES
        .iter()
        .filter(|spec| spec.shell == ShellKind::DesktopShell)
        .filter_map(|spec| spec.frame)
        .fold((0, 0), |acc, frame| (acc.0.max(frame.w), acc.1.max(frame.h)))
}

/// Validates the declared main window size against `CHROME_GEOMETRY` and `APPLE_DEVICES`.
///
/// Rejects a default window that would resolve to a mobile shell mode, a window
/// smaller than the largest desktop bezel frame, and a minimum height that cannot
/// hold the macOS menu bar plus toolbar.
fn validate_main_window_geometry(
    width: Option<f64>,
    height: Option<f64>,
    min_height: Option<f64>,
) -> Result<(), String> {
    let chrome_floor = CHROME_GEOMETRY.mac_menu_bar + CHROME_GEOMETRY.mac_toolbar;
    if let Some(min_h) = min_height {
        if (min_h.max(0.0) as u32) < chrome_floor {
            return Err(format!(
                "main window minHeight {min_h} is below Apple chrome floor {chrome_floor}"
            ));
        }
    }

    let (Some(width), Some(height)) = (width, height) else {
        return Ok(());
    };
    let (w, h) = (width.max(0.0) as u32, height.max(0.0) as u32);
    if w == 0 || h == 0 {
        return Err(format!("main window size {w}x{h} must be positive"));
    }

    let mode = resolve_device_mode(w);
    if mode.shell != ShellKind::DesktopShell {
        return Err(format!(
            "main window width {w} resolves to device {} with a mobile shell",
            mode.id
        ));
    }

    let (frame_w, frame_h) = desktop_frame_floor();
    if w < frame_w || h < frame_h {
        return Err(format!(
            "main window size {w}x{h} is smaller than Apple desktop frame {frame_w}x{frame_h}"
        ));
    }

    Ok(())
}

fn main() {
    let raw_env = std::env::var(HOST_ORIGIN_ENV).ok();
    let store = match build_initial_profile_store(raw_env.as_deref()) {
        Ok(store) => store,
        Err(err) => {
            eprintln!("mso-desktop-tauri startup rejected: {err}");
            std::process::exit(2);
        }
    };
    let init_script = build_initialization_script(store.active(), SHELL_VERSION);

    tauri::Builder::default()
        .manage(DesktopProfilesState(Mutex::new(store)))
        .invoke_handler(tauri::generate_handler![
            resolve_deep_link,
            list_host_profiles_json
        ])
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

            validate_main_window_geometry(
                Some(window_config.width),
                Some(window_config.height),
                window_config.min_height,
            )
            .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidInput, err))?;

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
    fn initial_profile_store_retains_local_default_alongside_remote_override() {
        let store = build_initial_profile_store(Some("https://mso.example.com"))
            .expect("store initialization should succeed");
        assert_eq!(store.len(), 2);
        assert_eq!(store.active().id, "remote-env");
        assert_eq!(store.active().api_base_origin(), "https://mso.example.com");

        let snapshot = store.to_json(SHELL_VERSION);
        assert!(snapshot.contains(r#""activeProfileId":"remote-env""#));
        assert!(snapshot.contains(r#""id":"local-default""#));
        assert!(snapshot.contains(r#""apiBaseOrigin":"https://mso.example.com""#));
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

    #[test]
    fn desktop_frame_floor_derives_from_desktop_shell_devices() {
        // Only the iPad registers a bezel frame on the desktop shell; the Mac spec
        // renders a plain window, so it contributes no floor.
        assert_eq!(desktop_frame_floor(), (1024, 768));
    }

    #[test]
    fn main_window_geometry_accepts_declared_tauri_default() {
        // Mirrors tauri.conf.json: 1280x820, minHeight 640.
        assert!(validate_main_window_geometry(Some(1280.0), Some(820.0), Some(640.0)).is_ok());
        // Unset dimensions defer to the Tauri default and are not rejected.
        assert!(validate_main_window_geometry(None, None, Some(640.0)).is_ok());
    }

    #[test]
    fn main_window_geometry_rejects_mobile_shell_undersized_and_short_windows() {
        let mobile = validate_main_window_geometry(Some(400.0), Some(900.0), None)
            .expect_err("mobile-shell width must be rejected");
        assert!(mobile.contains("mobile shell"));

        let undersized = validate_main_window_geometry(Some(1280.0), Some(700.0), None)
            .expect_err("height below the desktop frame floor must be rejected");
        assert!(undersized.contains("1024x768"));

        let short_min = validate_main_window_geometry(Some(1280.0), Some(820.0), Some(40.0))
            .expect_err("minHeight below menu bar plus toolbar must be rejected");
        assert!(short_min.contains("chrome floor"));

        assert_eq!(
            validate_main_window_geometry(Some(0.0), Some(820.0), None),
            Err("main window size 0x820 must be positive".to_string())
        );
    }
}
