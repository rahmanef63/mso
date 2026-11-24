export type ThemePresetGroupId = "refined" | "bold" | "warm" | "artistic" | "moody";

export type ThemePresetPalette = {
  bg: string;
  fg: string;
  card: string;
  primary: string;
  primaryFg: string;
  accent: string;
  muted: string;
  border: string;
  destructive: string;
};

export type ThemePreset = {
  name: string;
  title: string;
  group: ThemePresetGroupId;
  light: ThemePresetPalette;
  dark: ThemePresetPalette;
  radius: string;
};

export type ThemePresetGroup = {
  id: ThemePresetGroupId;
  label: string;
  items: readonly ThemePreset[];
};
