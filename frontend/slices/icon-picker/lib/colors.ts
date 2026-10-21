/** Notion-style color palette. Hex values aren't copyrightable; this
 *  matches Notion's named colors so users get familiar choices. */

export interface IconColor {
  id: string;
  label: string;
  hex: string;
}

export const ICON_COLORS: IconColor[] = [
  { id: "default", label: "Default", hex: "" }, // empty = inherit currentColor
  { id: "gray",    label: "Gray",    hex: "#9b9a97" },
  { id: "brown",   label: "Brown",   hex: "#64473a" },
  { id: "orange",  label: "Orange",  hex: "#d9730d" },
  { id: "yellow",  label: "Yellow",  hex: "#dfab01" },
  { id: "green",   label: "Green",   hex: "#0f7b6c" },
  { id: "blue",    label: "Blue",    hex: "#0b6e99" },
  { id: "purple",  label: "Purple",  hex: "#6940a5" },
  { id: "pink",    label: "Pink",    hex: "#ad1a72" },
  { id: "red",     label: "Red",     hex: "#e03e3e" },
];
