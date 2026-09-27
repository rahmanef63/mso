// shell-settings — portable, brand-free settings UI primitives. The generic
// Section/Row/Block building blocks the os-settings app composes; it carries no
// project-specific values. (The AppearancePanel that used to live here was
// unreachable — os-settings/components/appearance-section.tsx is the live UI.)
export { SettingsSection } from "./components/section";
export { SettingsRow, SettingsValueRow } from "./components/row";
export { SettingsActionRow } from "./components/action-row";
export { SettingsBlock } from "./components/block";
export { SettingsBreadcrumbs, SettingsFeatureCell, type SettingsBreadcrumb } from "./components/breadcrumbs";
