// Zero-dependency Rust core for the Apple OS Shell design system:
// device registry, chrome geometry, motion timings, z-index scale,
// Liquid Glass theme token engine, wallpaper engine, app registry, and pure helpers.
//
// 1:1 port of `apple-os-shell/shared/` (`devices.js`, `config.js`, `theme.js`,
// `registry.js`, `utils.js`) using only Rust `std`.

use std::fmt::Write as _;

// ---------------------------------------------------------------------------
// Device Registry (devices.js)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormFactor {
    Phone,
    Tablet,
    Desktop,
}

impl FormFactor {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Phone => "phone",
            Self::Tablet => "tablet",
            Self::Desktop => "desktop",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameType {
    Bezel,
    Window,
    None,
}

impl FrameType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bezel => "bezel",
            Self::Window => "window",
            Self::None => "none",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    MobileShell,
    DesktopShell,
}

impl ShellKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MobileShell => "MobileShell",
            Self::DesktopShell => "DesktopShell",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeviceFrame {
    pub w: u32,
    pub h: u32,
    pub radius: u32,
    pub bezel: u32,
}

impl DeviceFrame {
    pub fn to_json(&self) -> String {
        format!(
            r#"{{"w":{},"h":{},"radius":{},"bezel":{}}}"#,
            self.w, self.h, self.radius, self.bezel
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeviceSpec {
    pub id: &'static str,
    pub prop: &'static str,
    pub label: &'static str,
    pub os: &'static str,
    pub icon: &'static str,
    pub form_factor: FormFactor,
    pub shell: ShellKind,
    pub frame_type: FrameType,
    pub auto: bool,
    /// Upper viewport width breakpoint (exclusive). `None` represents Infinity.
    pub max_w: Option<u32>,
    pub frame: Option<DeviceFrame>,
}

impl DeviceSpec {
    /// Deterministic JSON serialization matching `shared/devices.js`.
    pub fn to_json(&self) -> String {
        let mut out = String::with_capacity(224);
        out.push('{');
        push_json_str_field(&mut out, "id", self.id, true);
        push_json_str_field(&mut out, "prop", self.prop, false);
        push_json_str_field(&mut out, "label", self.label, false);
        push_json_str_field(&mut out, "os", self.os, false);
        push_json_str_field(&mut out, "icon", self.icon, false);
        push_json_str_field(&mut out, "formFactor", self.form_factor.as_str(), false);
        push_json_str_field(&mut out, "shell", self.shell.as_str(), false);
        push_json_str_field(&mut out, "frameType", self.frame_type.as_str(), false);
        let _ = write!(out, r#","auto":{}"#, self.auto);
        match self.max_w {
            Some(max_w) => {
                let _ = write!(out, r#","maxW":{max_w}"#);
            }
            None => out.push_str(r#","maxW":null"#),
        }
        match self.frame {
            Some(frame) => {
                let _ = write!(out, r#","frame":{}"#, frame.to_json());
            }
            None => out.push_str(r#","frame":null"#),
        }
        out.push('}');
        out
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwitchSegment {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub os: &'static str,
}

pub const APPLE_DEVICES: &[DeviceSpec] = &[
    DeviceSpec {
        id: "ios",
        prop: "iPhone",
        label: "iPhone",
        os: "iOS",
        icon: "dev-iphone",
        form_factor: FormFactor::Phone,
        shell: ShellKind::MobileShell,
        frame_type: FrameType::Bezel,
        auto: true,
        max_w: Some(760),
        frame: Some(DeviceFrame {
            w: 402,
            h: 844,
            radius: 52,
            bezel: 11,
        }),
    },
    DeviceSpec {
        id: "ipad",
        prop: "iPad",
        label: "iPad",
        os: "iPadOS",
        icon: "dev-ipad",
        form_factor: FormFactor::Tablet,
        shell: ShellKind::DesktopShell,
        frame_type: FrameType::Bezel,
        auto: true,
        max_w: Some(1200),
        frame: Some(DeviceFrame {
            w: 1024,
            h: 768,
            radius: 30,
            bezel: 13,
        }),
    },
    DeviceSpec {
        id: "mac",
        prop: "Mac",
        label: "Mac",
        os: "macOS",
        icon: "dev-mac",
        form_factor: FormFactor::Desktop,
        shell: ShellKind::DesktopShell,
        frame_type: FrameType::Window,
        auto: true,
        max_w: None,
        frame: None,
    },
];

/// Resolves a viewport width (px) to the matching `auto: true` device spec,
/// ordered ascending by `max_w` (with `None` treated as Infinity).
pub fn resolve_device_mode(viewport_w: u32) -> &'static DeviceSpec {
    let mut auto_devices: Vec<&'static DeviceSpec> =
        APPLE_DEVICES.iter().filter(|d| d.auto).collect();
    auto_devices.sort_by_key(|d| d.max_w.unwrap_or(u32::MAX));

    for spec in &auto_devices {
        match spec.max_w {
            Some(limit) if viewport_w < limit => return spec,
            None => return spec,
            Some(_) => {}
        }
    }

    auto_devices
        .last()
        .copied()
        .unwrap_or(&APPLE_DEVICES[APPLE_DEVICES.len() - 1])
}

/// Looks up a registered device spec by its internal mode id (`"ios"`, `"ipad"`, `"mac"`).
pub fn device_by_id(id: &str) -> Option<&'static DeviceSpec> {
    APPLE_DEVICES.iter().find(|d| d.id == id)
}

/// Looks up a registered device spec by its root `device` prop (`"iPhone"`, `"iPad"`, `"Mac"`).
pub fn device_by_prop(prop: &str) -> Option<&'static DeviceSpec> {
    APPLE_DEVICES.iter().find(|d| d.prop == prop)
}

/// Maps a root `device` prop (`"auto"` | `"iPhone"` | `"iPad"` | `"Mac"`) to an internal mode id.
pub fn mode_from_prop(prop: &str) -> &'static str {
    if prop.is_empty() || prop == "auto" {
        return "auto";
    }
    match device_by_prop(prop) {
        Some(spec) => spec.id,
        None => "auto",
    }
}

/// Returns the device switcher rows: `"auto"` pseudo-device followed by every registered device.
pub fn switch_segments() -> Vec<SwitchSegment> {
    let mut rows = Vec::with_capacity(APPLE_DEVICES.len() + 1);
    rows.push(SwitchSegment {
        id: "auto",
        label: "Auto",
        icon: "dev-auto",
        os: "Adaptive",
    });
    for d in APPLE_DEVICES {
        rows.push(SwitchSegment {
            id: d.id,
            label: d.label,
            icon: d.icon,
            os: d.os,
        });
    }
    rows
}

// ---------------------------------------------------------------------------
// Behavioural Config: Chrome Geometry, Motion Timings, Z-Index Scale (config.js)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChromeGeometry {
    pub mac_toolbar: u32,
    pub mac_menu_bar: u32,
    pub phone_status: u32,
    pub phone_nav: u32,
    pub phone_tab_bar: u32,
    pub phone_home_pad: u32,
    pub pad_status: u32,
    pub pad_toolbar: u32,
    pub pad_top_pad: u32,
    pub pad_home_pad: u32,
}

pub const CHROME_GEOMETRY: ChromeGeometry = ChromeGeometry {
    mac_toolbar: 52,
    mac_menu_bar: 26,
    phone_status: 44,
    phone_nav: 46,
    phone_tab_bar: 92,
    phone_home_pad: 34,
    pad_status: 24,
    pad_toolbar: 48,
    pad_top_pad: 92,
    pad_home_pad: 34,
};

impl Default for ChromeGeometry {
    fn default() -> Self {
        CHROME_GEOMETRY
    }
}

impl ChromeGeometry {
    pub fn to_json(&self) -> String {
        format!(
            r#"{{"macToolbar":{},"macMenuBar":{},"phoneStatus":{},"phoneNav":{},"phoneTabBar":{},"phoneHomePad":{},"padStatus":{},"padToolbar":{},"padTopPad":{},"padHomePad":{}}}"#,
            self.mac_toolbar,
            self.mac_menu_bar,
            self.phone_status,
            self.phone_nav,
            self.phone_tab_bar,
            self.phone_home_pad,
            self.pad_status,
            self.pad_toolbar,
            self.pad_top_pad,
            self.pad_home_pad,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MotionTimings {
    pub base: &'static str,
    pub fast: &'static str,
}

pub const MOTION_TIMINGS: MotionTimings = MotionTimings {
    base: ".42s",
    fast: ".2s",
};

pub const MOTION_TIMINGS_REDUCED: MotionTimings = MotionTimings {
    base: "0s",
    fast: "0s",
};

impl Default for MotionTimings {
    fn default() -> Self {
        MOTION_TIMINGS
    }
}

impl MotionTimings {
    pub const fn for_reduce_motion(reduce_motion: bool) -> Self {
        if reduce_motion {
            MOTION_TIMINGS_REDUCED
        } else {
            MOTION_TIMINGS
        }
    }

    pub fn to_json(&self) -> String {
        let mut out = String::with_capacity(40);
        out.push('{');
        push_json_str_field(&mut out, "base", self.base, true);
        push_json_str_field(&mut out, "fast", self.fast, false);
        out.push('}');
        out
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ZIndexScale {
    pub wall: u32,
    pub screen: u32,
    pub chrome: u32,
    pub status_overlay: u32,
    pub dock: u32,
    pub menu_bar: u32,
    pub menu_drop: u32,
    pub ctx_catcher: u32,
    pub ctx: u32,
    pub toast: u32,
    pub preview: u32,
}

pub const Z_INDEX_SCALE: ZIndexScale = ZIndexScale {
    wall: 0,
    screen: 20,
    chrome: 30,
    status_overlay: 40,
    dock: 55,
    menu_bar: 60,
    menu_drop: 80,
    ctx_catcher: 90,
    ctx: 91,
    toast: 95,
    preview: 99,
};

impl Default for ZIndexScale {
    fn default() -> Self {
        Z_INDEX_SCALE
    }
}

impl ZIndexScale {
    pub fn to_json(&self) -> String {
        format!(
            r#"{{"wall":{},"screen":{},"chrome":{},"statusOverlay":{},"dock":{},"menuBar":{},"menuDrop":{},"ctxCatcher":{},"ctx":{},"toast":{},"preview":{}}}"#,
            self.wall,
            self.screen,
            self.chrome,
            self.status_overlay,
            self.dock,
            self.menu_bar,
            self.menu_drop,
            self.ctx_catcher,
            self.ctx,
            self.toast,
            self.preview,
        )
    }
}

// ---------------------------------------------------------------------------
// Liquid Glass Theme Engine & Wallpapers (theme.js)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AppleA11yFlags {
    pub reduce_motion: bool,
    pub reduce_transparency: bool,
    pub increase_contrast: bool,
    pub bold_text: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppleThemeVars {
    pub bg: &'static str,
    pub grouped: &'static str,
    pub elev: &'static str,
    pub card: &'static str,
    pub label: &'static str,
    pub label2: &'static str,
    pub label3: &'static str,
    pub sep: &'static str,
    pub fill: &'static str,
    pub fill2: &'static str,
    pub sidebar: &'static str,
    pub glass_bg: &'static str,
    pub glass_stroke: &'static str,
    pub glass_hi: &'static str,
    pub shadow: &'static str,
    pub menubar: &'static str,
    pub tint: String,
    pub blur: &'static str,
}

/// Computes the full semantic design-token palette for a given appearance,
/// accessibility flags, and accent color (1:1 with `theme.js::computeVars`).
pub fn compute_theme_vars(dark: bool, a11y: AppleA11yFlags, accent: &str) -> AppleThemeVars {
    let mut v = if dark {
        AppleThemeVars {
            bg: "#1c1c1e",
            grouped: "#000000",
            elev: "#2c2c2e",
            card: "#1c1c1e",
            label: "#ffffff",
            label2: "rgba(235,235,245,.6)",
            label3: "rgba(235,235,245,.3)",
            sep: "rgba(255,255,255,.1)",
            fill: "rgba(120,120,128,.24)",
            fill2: "rgba(120,120,128,.36)",
            sidebar: "rgba(30,30,33,.62)",
            glass_bg: "rgba(44,44,50,.55)",
            glass_stroke: "rgba(255,255,255,.14)",
            glass_hi: "rgba(255,255,255,.2)",
            shadow: "rgba(0,0,0,.55)",
            menubar: "rgba(0,0,0,.3)",
            tint: accent.to_string(),
            blur: "26px",
        }
    } else {
        AppleThemeVars {
            bg: "#ffffff",
            grouped: "#f2f2f7",
            elev: "#ffffff",
            card: "#ffffff",
            label: "#1c1c1e",
            label2: "rgba(60,60,67,.6)",
            label3: "rgba(60,60,67,.3)",
            sep: "rgba(60,60,67,.16)",
            fill: "rgba(118,118,128,.12)",
            fill2: "rgba(118,118,128,.24)",
            sidebar: "rgba(246,246,248,.72)",
            glass_bg: "rgba(252,252,254,.62)",
            glass_stroke: "rgba(255,255,255,.7)",
            glass_hi: "rgba(255,255,255,.95)",
            shadow: "rgba(0,0,0,.18)",
            menubar: "rgba(255,255,255,.42)",
            tint: accent.to_string(),
            blur: "26px",
        }
    };

    if a11y.reduce_transparency {
        v.glass_bg = if dark { "#28282c" } else { "#f4f4f6" };
        v.sidebar = if dark { "#202023" } else { "#ececef" };
        v.menubar = if dark { "#161618" } else { "#e9e9ec" };
        v.glass_hi = "transparent";
        v.blur = "0px";
    }

    if a11y.increase_contrast {
        v.label = if dark { "#ffffff" } else { "#000000" };
        v.label2 = if dark {
            "rgba(235,235,245,.85)"
        } else {
            "rgba(0,0,0,.72)"
        };
        v.sep = if dark {
            "rgba(255,255,255,.34)"
        } else {
            "rgba(0,0,0,.4)"
        };
        v.glass_stroke = if dark {
            "rgba(255,255,255,.5)"
        } else {
            "rgba(0,0,0,.5)"
        };
    }

    v
}

impl AppleThemeVars {
    /// Deterministic JSON serialization matching `theme.js::computeVars` output keys.
    pub fn to_json(&self) -> String {
        let mut out = String::with_capacity(512);
        out.push('{');
        push_json_str_field(&mut out, "bg", self.bg, true);
        push_json_str_field(&mut out, "grouped", self.grouped, false);
        push_json_str_field(&mut out, "elev", self.elev, false);
        push_json_str_field(&mut out, "card", self.card, false);
        push_json_str_field(&mut out, "label", self.label, false);
        push_json_str_field(&mut out, "label2", self.label2, false);
        push_json_str_field(&mut out, "label3", self.label3, false);
        push_json_str_field(&mut out, "sep", self.sep, false);
        push_json_str_field(&mut out, "fill", self.fill, false);
        push_json_str_field(&mut out, "fill2", self.fill2, false);
        push_json_str_field(&mut out, "sidebar", self.sidebar, false);
        push_json_str_field(&mut out, "glassBg", self.glass_bg, false);
        push_json_str_field(&mut out, "glassStroke", self.glass_stroke, false);
        push_json_str_field(&mut out, "glassHi", self.glass_hi, false);
        push_json_str_field(&mut out, "shadow", self.shadow, false);
        push_json_str_field(&mut out, "menubar", self.menubar, false);
        push_json_str_field(&mut out, "tint", &self.tint, false);
        push_json_str_field(&mut out, "blur", self.blur, false);
        out.push('}');
        out
    }

    /// Builds the inline CSS custom-property string applied to the root element
    /// (1:1 with `theme.js::rootVars`).
    pub fn root_css_vars(&self, timings: MotionTimings, bold_text: bool) -> String {
        let weight = if bold_text { "500" } else { "400" };
        format!(
            "--bg:{};--grouped:{};--elev:{};--card:{};--label:{};--label2:{};--label3:{};--sep:{};--fill:{};--fill2:{};--sidebar:{};--glass-bg:{};--glass-stroke:{};--glass-hi:{};--glass-shadow:{};--menubar:{};--blur:{};--tint:{};--dur:{};--durF:{};position:relative;width:100%;height:100vh;overflow:hidden;color:var(--label);font-weight:{};-webkit-font-smoothing:antialiased;font-size:15px;user-select:none;letter-spacing:-.01em;font-family:-apple-system,\"SF Pro Text\",BlinkMacSystemFont,\"Helvetica Neue\",Helvetica,Arial,sans-serif;",
            self.bg,
            self.grouped,
            self.elev,
            self.card,
            self.label,
            self.label2,
            self.label3,
            self.sep,
            self.fill,
            self.fill2,
            self.sidebar,
            self.glass_bg,
            self.glass_stroke,
            self.glass_hi,
            self.shadow,
            self.menubar,
            self.blur,
            self.tint,
            timings.base,
            timings.fast,
            weight,
        )
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum AppleWallpaper {
    #[default]
    Aurora,
    Graphite,
    Sunset,
}

impl AppleWallpaper {
    pub fn from_id(id: &str) -> Self {
        match id {
            "graphite" => Self::Graphite,
            "sunset" => Self::Sunset,
            _ => Self::Aurora,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Aurora => "aurora",
            Self::Graphite => "graphite",
            Self::Sunset => "sunset",
        }
    }
}

/// Returns the CSS gradient stack for the requested wallpaper and appearance
/// (1:1 with `theme.js::wallpaperCss`).
pub const fn wallpaper_css(w: AppleWallpaper, dark: bool) -> &'static str {
    match (w, dark) {
        (AppleWallpaper::Aurora, true) => {
            "radial-gradient(120% 90% at 12% 8%,#24408f 0%,transparent 55%),radial-gradient(120% 100% at 88% 16%,#6a2a8c 0%,transparent 50%),radial-gradient(130% 120% at 60% 108%,#0c5c6e 0%,transparent 55%),linear-gradient(160deg,#0b0b16,#141024)"
        }
        (AppleWallpaper::Aurora, false) => {
            "radial-gradient(120% 90% at 12% 8%,#bcdcff 0%,transparent 55%),radial-gradient(120% 100% at 88% 16%,#ffd6ec 0%,transparent 48%),radial-gradient(130% 120% at 60% 108%,#c9f3ea 0%,transparent 55%),linear-gradient(160deg,#eaf1fb,#f4eefb)"
        }
        (AppleWallpaper::Graphite, true) => {
            "radial-gradient(120% 100% at 20% 12%,#2b303c 0%,transparent 60%),radial-gradient(120% 100% at 85% 90%,#1a2330 0%,transparent 55%),linear-gradient(160deg,#0e1013,#191c22)"
        }
        (AppleWallpaper::Graphite, false) => {
            "radial-gradient(120% 100% at 20% 12%,#e1e6ee 0%,transparent 60%),radial-gradient(120% 100% at 85% 90%,#ccd4e0 0%,transparent 55%),linear-gradient(160deg,#eef1f5,#e2e6ee)"
        }
        (AppleWallpaper::Sunset, true) => {
            "radial-gradient(120% 90% at 15% 10%,#7a2352 0%,transparent 55%),radial-gradient(120% 100% at 85% 14%,#b3541f 0%,transparent 50%),radial-gradient(120% 120% at 60% 110%,#2a1b52 0%,transparent 55%),linear-gradient(160deg,#160b12,#231018)"
        }
        (AppleWallpaper::Sunset, false) => {
            "radial-gradient(120% 90% at 15% 10%,#ffd1e0 0%,transparent 55%),radial-gradient(120% 100% at 85% 14%,#ffe0bf 0%,transparent 50%),radial-gradient(120% 120% at 60% 110%,#e6d6ff 0%,transparent 55%),linear-gradient(160deg,#fff2f6,#fbeede)"
        }
    }
}

/// Computes the CSS `filter` string for wallpaper brightness (0..=100) and Night Shift.
pub fn wallpaper_filter(brightness: u8, night_shift: bool) -> String {
    let clamped = brightness.min(100) as f64;
    let factor = 0.62 + (clamped / 100.0) * 0.52;
    let mut filt = format!("brightness({factor:.2})");
    if night_shift {
        filt.push_str(" sepia(.34) saturate(1.14) hue-rotate(-14deg)");
    }
    filt
}

// ---------------------------------------------------------------------------
// App Registry & Accents (registry.js)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppEntry {
    pub id: &'static str,
    pub name: &'static str,
    pub icon: &'static str,
    pub real: bool,
}

pub const APPLE_APPS: &[AppEntry] = &[
    AppEntry { id: "settings", name: "Settings", icon: "a-settings", real: true },
    AppEntry { id: "files", name: "Files", icon: "a-files", real: true },
    AppEntry { id: "notes", name: "Notes", icon: "a-notes", real: true },
    AppEntry { id: "mail", name: "Mail", icon: "a-mail", real: true },
    AppEntry { id: "music", name: "Music", icon: "a-music", real: true },
    AppEntry { id: "sandbox", name: "Sandbox", icon: "a-sandbox", real: true },
    AppEntry { id: "photos", name: "Photos", icon: "a-photos", real: true },
    AppEntry { id: "safari", name: "Safari", icon: "a-safari", real: true },
    AppEntry { id: "messages", name: "Messages", icon: "a-messages", real: true },
    AppEntry { id: "maps", name: "Maps", icon: "a-maps", real: true },
];

pub const APPLE_DOCK: &[&str] = &[
    "settings", "files", "notes", "mail", "music", "photos", "safari", "messages", "maps",
    "sandbox",
];

pub const APPLE_SPRING_DOCK: &[&str] = &["settings", "files", "notes", "sandbox"];

/// Accent swatches offered in Settings > Appearance (`registry.js::accents`).
pub const APPLE_ACCENTS: [&str; 7] = [
    "#0a84ff", "#5e5ce6", "#bf5af2", "#ff375f", "#ff9f0a", "#30d158", "#8e8e93",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TabDef {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
}

pub const FILES_TAB_DEFS: &[TabDef] = &[
    TabDef { id: "recents", label: "Recents", icon: "clock" },
    TabDef { id: "shared", label: "Shared", icon: "people" },
    TabDef { id: "browse", label: "Browse", icon: "folder" },
];

/// Resolves macOS window / menu-bar display title for an app id (`registry.js::appNames`).
pub fn app_display_name(id: &str) -> Option<&'static str> {
    match id {
        "settings" => Some("System Settings"),
        "files" => Some("Finder"),
        "notes" => Some("Notes"),
        "mail" => Some("Mail"),
        "music" => Some("Music"),
        "sandbox" => Some("Sandbox"),
        "photos" => Some("Photos"),
        "safari" => Some("Safari"),
        "messages" => Some("Messages"),
        "maps" => Some("Maps"),
        "camera" => Some("Camera"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Pure Helpers (utils.js)
// ---------------------------------------------------------------------------

/// Darkens a `#RRGGBB` hex color (`r*0.68`, `g*0.68`, `b*0.72`), matching `utils.js::shade`.
/// Returns the input string unchanged if it is not a valid 6-digit `#RRGGBB` hex color.
pub fn shade_hex(hex: &str) -> String {
    let Some(digits) = hex.strip_prefix('#') else {
        return hex.to_string();
    };
    if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return hex.to_string();
    }
    let Ok(n) = u32::from_str_radix(digits, 16) else {
        return hex.to_string();
    };
    let r = (((n >> 16) & 255) as f64 * 0.68).round() as u8;
    let g = (((n >> 8) & 255) as f64 * 0.68).round() as u8;
    let b = ((n & 255) as f64 * 0.72).round() as u8;
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Case-insensitive color comparison (`utils.js::eqC`).
pub fn eq_color(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// Plain-text preview from rich-text HTML (`utils.js::snippetOf`).
pub fn snippet_of(html: &str) -> String {
    let mut stripped = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                stripped.push(' ');
            }
            '>' => {
                in_tag = false;
            }
            _ if !in_tag => stripped.push(ch),
            _ => {}
        }
    }
    let decoded = stripped.replace("&nbsp;", " ").replace("&amp;", "&");
    let collapsed: String = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        "No additional text".to_string()
    } else {
        collapsed.chars().take(60).collect()
    }
}

// ---------------------------------------------------------------------------
// Internal zero-dependency JSON escaping
// ---------------------------------------------------------------------------

fn push_json_str_field(out: &mut String, key: &str, val: &str, first: bool) {
    if !first {
        out.push(',');
    }
    out.push('"');
    push_json_escaped(out, key);
    out.push_str(r#"":""#);
    push_json_escaped(out, val);
    out.push('"');
}

fn push_json_escaped(out: &mut String, s: &str) {
    for ch in s.chars() {
        match ch {
            '"' => out.push_str(r#"\""#),
            '\\' => out.push_str(r#"\\"#),
            '\x08' => out.push_str(r#"\b"#),
            '\x0c' => out.push_str(r#"\f"#),
            '\n' => out.push_str(r#"\n"#),
            '\r' => out.push_str(r#"\r"#),
            '\t' => out.push_str(r#"\t"#),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_resolution_breakpoints() {
        assert_eq!(resolve_device_mode(320).id, "ios");
        assert_eq!(resolve_device_mode(390).id, "ios");
        assert_eq!(resolve_device_mode(759).id, "ios");
        assert_eq!(resolve_device_mode(760).id, "ipad");
        assert_eq!(resolve_device_mode(1024).id, "ipad");
        assert_eq!(resolve_device_mode(1199).id, "ipad");
        assert_eq!(resolve_device_mode(1200).id, "mac");
        assert_eq!(resolve_device_mode(1440).id, "mac");
        assert_eq!(resolve_device_mode(u32::MAX).id, "mac");
    }

    #[test]
    fn device_registry_specs_match_js_ssot() {
        assert_eq!(APPLE_DEVICES.len(), 3);

        let ios = device_by_id("ios").expect("ios device must exist");
        assert_eq!(ios.prop, "iPhone");
        assert_eq!(ios.os, "iOS");
        assert_eq!(ios.form_factor, FormFactor::Phone);
        assert_eq!(ios.shell, ShellKind::MobileShell);
        assert_eq!(ios.frame_type, FrameType::Bezel);
        assert_eq!(ios.max_w, Some(760));
        assert_eq!(
            ios.frame,
            Some(DeviceFrame {
                w: 402,
                h: 844,
                radius: 52,
                bezel: 11,
            })
        );

        let ipad = device_by_id("ipad").expect("ipad device must exist");
        assert_eq!(ipad.prop, "iPad");
        assert_eq!(ipad.os, "iPadOS");
        assert_eq!(ipad.form_factor, FormFactor::Tablet);
        assert_eq!(ipad.shell, ShellKind::DesktopShell);
        assert_eq!(ipad.frame_type, FrameType::Bezel);
        assert_eq!(ipad.max_w, Some(1200));
        assert_eq!(
            ipad.frame,
            Some(DeviceFrame {
                w: 1024,
                h: 768,
                radius: 30,
                bezel: 13,
            })
        );

        let mac = device_by_id("mac").expect("mac device must exist");
        assert_eq!(mac.prop, "Mac");
        assert_eq!(mac.os, "macOS");
        assert_eq!(mac.form_factor, FormFactor::Desktop);
        assert_eq!(mac.shell, ShellKind::DesktopShell);
        assert_eq!(mac.frame_type, FrameType::Window);
        assert_eq!(mac.max_w, None);
        assert_eq!(mac.frame, None);

        assert!(device_by_id("unknown").is_none());
    }

    #[test]
    fn mode_from_prop_mapping() {
        assert_eq!(mode_from_prop(""), "auto");
        assert_eq!(mode_from_prop("auto"), "auto");
        assert_eq!(mode_from_prop("iPhone"), "ios");
        assert_eq!(mode_from_prop("iPad"), "ipad");
        assert_eq!(mode_from_prop("Mac"), "mac");
        assert_eq!(mode_from_prop("VisionPro"), "auto");
    }

    #[test]
    fn switch_segments_includes_auto_then_devices() {
        let segs = switch_segments();
        assert_eq!(segs.len(), 4);
        assert_eq!(segs[0].id, "auto");
        assert_eq!(segs[0].os, "Adaptive");
        assert_eq!(segs[1].id, "ios");
        assert_eq!(segs[2].id, "ipad");
        assert_eq!(segs[3].id, "mac");
    }

    #[test]
    fn chrome_geometry_motion_and_z_index_defaults() {
        let c = ChromeGeometry::default();
        assert_eq!(c.mac_toolbar, 52);
        assert_eq!(c.mac_menu_bar, 26);
        assert_eq!(c.phone_status, 44);
        assert_eq!(c.phone_nav, 46);
        assert_eq!(c.phone_tab_bar, 92);
        assert_eq!(c.phone_home_pad, 34);
        assert_eq!(c.pad_status, 24);
        assert_eq!(c.pad_toolbar, 48);
        assert_eq!(c.pad_top_pad, 92);
        assert_eq!(c.pad_home_pad, 34);

        let m_norm = MotionTimings::for_reduce_motion(false);
        assert_eq!(m_norm.base, ".42s");
        assert_eq!(m_norm.fast, ".2s");
        let m_red = MotionTimings::for_reduce_motion(true);
        assert_eq!(m_red.base, "0s");
        assert_eq!(m_red.fast, "0s");

        let z = ZIndexScale::default();
        assert_eq!(z.wall, 0);
        assert_eq!(z.screen, 20);
        assert_eq!(z.chrome, 30);
        assert_eq!(z.status_overlay, 40);
        assert_eq!(z.dock, 55);
        assert_eq!(z.menu_bar, 60);
        assert_eq!(z.menu_drop, 80);
        assert_eq!(z.ctx_catcher, 90);
        assert_eq!(z.ctx, 91);
        assert_eq!(z.toast, 95);
        assert_eq!(z.preview, 99);
        assert!(z.wall < z.screen);
        assert!(z.screen < z.chrome);
        assert!(z.chrome < z.status_overlay);
        assert!(z.status_overlay < z.dock);
        assert!(z.dock < z.menu_bar);
        assert!(z.menu_bar < z.menu_drop);
        assert!(z.menu_drop < z.ctx_catcher);
        assert!(z.ctx_catcher < z.ctx);
        assert!(z.ctx < z.toast);
        assert!(z.toast < z.preview);
    }

    #[test]
    fn compute_theme_vars_dark_and_light() {
        let dark = compute_theme_vars(true, AppleA11yFlags::default(), "#0a84ff");
        assert_eq!(dark.bg, "#1c1c1e");
        assert_eq!(dark.grouped, "#000000");
        assert_eq!(dark.elev, "#2c2c2e");
        assert_eq!(dark.card, "#1c1c1e");
        assert_eq!(dark.label, "#ffffff");
        assert_eq!(dark.label2, "rgba(235,235,245,.6)");
        assert_eq!(dark.label3, "rgba(235,235,245,.3)");
        assert_eq!(dark.sep, "rgba(255,255,255,.1)");
        assert_eq!(dark.fill, "rgba(120,120,128,.24)");
        assert_eq!(dark.fill2, "rgba(120,120,128,.36)");
        assert_eq!(dark.sidebar, "rgba(30,30,33,.62)");
        assert_eq!(dark.glass_bg, "rgba(44,44,50,.55)");
        assert_eq!(dark.glass_stroke, "rgba(255,255,255,.14)");
        assert_eq!(dark.glass_hi, "rgba(255,255,255,.2)");
        assert_eq!(dark.shadow, "rgba(0,0,0,.55)");
        assert_eq!(dark.menubar, "rgba(0,0,0,.3)");
        assert_eq!(dark.tint, "#0a84ff");
        assert_eq!(dark.blur, "26px");

        let light = compute_theme_vars(false, AppleA11yFlags::default(), "#ff375f");
        assert_eq!(light.bg, "#ffffff");
        assert_eq!(light.grouped, "#f2f2f7");
        assert_eq!(light.elev, "#ffffff");
        assert_eq!(light.card, "#ffffff");
        assert_eq!(light.label, "#1c1c1e");
        assert_eq!(light.label2, "rgba(60,60,67,.6)");
        assert_eq!(light.label3, "rgba(60,60,67,.3)");
        assert_eq!(light.sep, "rgba(60,60,67,.16)");
        assert_eq!(light.fill, "rgba(118,118,128,.12)");
        assert_eq!(light.fill2, "rgba(118,118,128,.24)");
        assert_eq!(light.sidebar, "rgba(246,246,248,.72)");
        assert_eq!(light.glass_bg, "rgba(252,252,254,.62)");
        assert_eq!(light.glass_stroke, "rgba(255,255,255,.7)");
        assert_eq!(light.glass_hi, "rgba(255,255,255,.95)");
        assert_eq!(light.shadow, "rgba(0,0,0,.18)");
        assert_eq!(light.menubar, "rgba(255,255,255,.42)");
        assert_eq!(light.tint, "#ff375f");
        assert_eq!(light.blur, "26px");
    }

    #[test]
    fn compute_theme_vars_reduce_transparency_overrides() {
        let a11y = AppleA11yFlags {
            reduce_transparency: true,
            ..Default::default()
        };

        let dark = compute_theme_vars(true, a11y, "#0a84ff");
        assert_eq!(dark.glass_bg, "#28282c");
        assert_eq!(dark.sidebar, "#202023");
        assert_eq!(dark.menubar, "#161618");
        assert_eq!(dark.glass_hi, "transparent");
        assert_eq!(dark.blur, "0px");

        let light = compute_theme_vars(false, a11y, "#0a84ff");
        assert_eq!(light.glass_bg, "#f4f4f6");
        assert_eq!(light.sidebar, "#ececef");
        assert_eq!(light.menubar, "#e9e9ec");
        assert_eq!(light.glass_hi, "transparent");
        assert_eq!(light.blur, "0px");
    }

    #[test]
    fn compute_theme_vars_increase_contrast_overrides() {
        let a11y = AppleA11yFlags {
            increase_contrast: true,
            ..Default::default()
        };

        let dark = compute_theme_vars(true, a11y, "#0a84ff");
        assert_eq!(dark.label, "#ffffff");
        assert_eq!(dark.label2, "rgba(235,235,245,.85)");
        assert_eq!(dark.sep, "rgba(255,255,255,.34)");
        assert_eq!(dark.glass_stroke, "rgba(255,255,255,.5)");

        let light = compute_theme_vars(false, a11y, "#0a84ff");
        assert_eq!(light.label, "#000000");
        assert_eq!(light.label2, "rgba(0,0,0,.72)");
        assert_eq!(light.sep, "rgba(0,0,0,.4)");
        assert_eq!(light.glass_stroke, "rgba(0,0,0,.5)");
    }

    #[test]
    fn compute_theme_vars_combined_a11y_and_root_css() {
        let a11y = AppleA11yFlags {
            reduce_motion: true,
            reduce_transparency: true,
            increase_contrast: true,
            bold_text: true,
        };
        let vars = compute_theme_vars(false, a11y, "#30d158");
        assert_eq!(vars.blur, "0px");
        assert_eq!(vars.label, "#000000");
        assert_eq!(vars.glass_bg, "#f4f4f6");

        let css = vars.root_css_vars(MotionTimings::for_reduce_motion(a11y.reduce_motion), a11y.bold_text);
        assert!(css.contains("--blur:0px;"));
        assert!(css.contains("--tint:#30d158;"));
        assert!(css.contains("--dur:0s;--durF:0s;"));
        assert!(css.contains("font-weight:500;"));
    }

    #[test]
    fn wallpapers_and_filters() {
        assert_eq!(AppleWallpaper::from_id("aurora"), AppleWallpaper::Aurora);
        assert_eq!(AppleWallpaper::from_id("graphite"), AppleWallpaper::Graphite);
        assert_eq!(AppleWallpaper::from_id("sunset"), AppleWallpaper::Sunset);
        assert_eq!(AppleWallpaper::from_id("missing"), AppleWallpaper::Aurora);

        assert!(wallpaper_css(AppleWallpaper::Aurora, true).contains("#24408f"));
        assert!(wallpaper_css(AppleWallpaper::Aurora, false).contains("#bcdcff"));
        assert!(wallpaper_css(AppleWallpaper::Graphite, true).contains("#2b303c"));
        assert!(wallpaper_css(AppleWallpaper::Graphite, false).contains("#e1e6ee"));
        assert!(wallpaper_css(AppleWallpaper::Sunset, true).contains("#7a2352"));
        assert!(wallpaper_css(AppleWallpaper::Sunset, false).contains("#ffd1e0"));

        assert_eq!(wallpaper_filter(0, false), "brightness(0.62)");
        assert_eq!(wallpaper_filter(74, false), "brightness(1.00)");
        assert_eq!(wallpaper_filter(100, false), "brightness(1.14)");
        assert_eq!(wallpaper_filter(200, false), "brightness(1.14)");
        assert_eq!(
            wallpaper_filter(74, true),
            "brightness(1.00) sepia(.34) saturate(1.14) hue-rotate(-14deg)"
        );
    }

    #[test]
    fn accents_registry_and_helpers() {
        assert_eq!(
            APPLE_ACCENTS,
            [
                "#0a84ff", "#5e5ce6", "#bf5af2", "#ff375f", "#ff9f0a", "#30d158", "#8e8e93"
            ]
        );
        assert_eq!(APPLE_APPS.len(), 10);
        assert_eq!(APPLE_DOCK.len(), 10);
        assert_eq!(APPLE_SPRING_DOCK, &["settings", "files", "notes", "sandbox"]);
        assert_eq!(app_display_name("settings"), Some("System Settings"));
        assert_eq!(app_display_name("files"), Some("Finder"));
        assert_eq!(app_display_name("camera"), Some("Camera"));
        assert_eq!(app_display_name("none"), None);
        assert_eq!(FILES_TAB_DEFS.len(), 3);

        assert_eq!(shade_hex("#0a84ff"), "#075ab8");
        assert_eq!(shade_hex("#ffffff"), "#adadb8");
        assert_eq!(shade_hex("#000000"), "#000000");
        assert_eq!(shade_hex("invalid"), "invalid");
        assert_eq!(shade_hex("#123"), "#123");

        assert!(eq_color("#0A84FF", "#0a84ff"));
        assert!(!eq_color("#0a84ff", "#5e5ce6"));

        assert_eq!(
            snippet_of("<p>Hello&nbsp;<b>world</b> &amp; friends</p>"),
            "Hello world & friends"
        );
        assert_eq!(snippet_of("<br>   "), "No additional text");
    }

    #[test]
    fn json_serialization_is_deterministic_and_escaped() {
        let ios = device_by_id("ios").unwrap();
        assert_eq!(
            ios.to_json(),
            r#"{"id":"ios","prop":"iPhone","label":"iPhone","os":"iOS","icon":"dev-iphone","formFactor":"phone","shell":"MobileShell","frameType":"bezel","auto":true,"maxW":760,"frame":{"w":402,"h":844,"radius":52,"bezel":11}}"#
        );

        let mac = device_by_id("mac").unwrap();
        assert_eq!(
            mac.to_json(),
            r#"{"id":"mac","prop":"Mac","label":"Mac","os":"macOS","icon":"dev-mac","formFactor":"desktop","shell":"DesktopShell","frameType":"window","auto":true,"maxW":null,"frame":null}"#
        );

        let vars = compute_theme_vars(true, AppleA11yFlags::default(), "#0a84ff");
        let vars_json = vars.to_json();
        assert!(vars_json.starts_with(r##"{"bg":"#1c1c1e","grouped":"#000000","##));
        assert!(vars_json.contains(r#""glassBg":"rgba(44,44,50,.55)""#));
        assert!(vars_json.contains(r#""glassStroke":"rgba(255,255,255,.14)""#));
        assert!(vars_json.contains(r#""glassHi":"rgba(255,255,255,.2)""#));
        assert!(vars_json.ends_with(r##""tint":"#0a84ff","blur":"26px"}"##));

        // Verify JSON escaping on untrusted accent strings.
        let weird = compute_theme_vars(false, AppleA11yFlags::default(), "red\"\\\n\t");
        assert!(weird.to_json().contains(r#""tint":"red\"\\\n\t""#));

        assert_eq!(
            ChromeGeometry::default().to_json(),
            r#"{"macToolbar":52,"macMenuBar":26,"phoneStatus":44,"phoneNav":46,"phoneTabBar":92,"phoneHomePad":34,"padStatus":24,"padToolbar":48,"padTopPad":92,"padHomePad":34}"#
        );
        assert_eq!(
            MotionTimings::default().to_json(),
            r#"{"base":".42s","fast":".2s"}"#
        );
        assert_eq!(
            ZIndexScale::default().to_json(),
            r#"{"wall":0,"screen":20,"chrome":30,"statusOverlay":40,"dock":55,"menuBar":60,"menuDrop":80,"ctxCatcher":90,"ctx":91,"toast":95,"preview":99}"#
        );
    }
}
