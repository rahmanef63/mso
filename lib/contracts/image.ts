import type { CSSProperties } from "react";

export type ImageSource = "color" | "gradient" | "texture" | "upload" | "link" | "unsplash";
export interface ImageValue {
  type: ImageSource;
  value: string;
  positionY?: number;
  metadata?: Record<string, unknown>;
}
export type ImageField = string | ImageValue | null | undefined;

const gradient = (value: string) => /^(linear|radial|conic)-gradient\(/i.test(value.trim());
const color = (value: string) => {
  const v = value.trim();
  return /^#[0-9a-f]{3,8}$/i.test(v)
    || /^(rgb|rgba|hsl|hsla)\(/i.test(v)
    || /^(red|blue|green|black|white|gray|grey|yellow|orange|purple|pink|brown)$/i.test(v);
};
const url = (value: string) => /^https?:\/\//i.test(value.trim()) || /^storage:/i.test(value.trim());

export function parseImage(field: ImageField): ImageValue | null {
  if (!field) return null;
  if (typeof field === "object") return field;
  const value = field.trim();
  if (!value) return null;
  if (gradient(value)) return { type: "gradient", value, positionY: 50 };
  if (color(value)) return { type: "color", value, positionY: 50 };
  if (url(value)) return { type: "link", value, positionY: 50 };
  return { type: "color", value, positionY: 50 };
}
export const isCssImage = (value: ImageValue) => value.type === "color" || value.type === "gradient";
export const isUrlImage = (value: ImageValue) => !isCssImage(value);
export const imageRef = (value: ImageValue | null) => value?.type === "upload" ? value.value : null;

export function imageStyle(img: ImageValue, resolvedUrl?: string | null): CSSProperties {
  const posY = img.positionY ?? 50;
  if (isUrlImage(img)) {
    const raw = resolvedUrl ?? img.value;
    const safeUrl = raw.replace(/[\\"]/g, "\\$&").replace(/[\r\n]/g, "");
    return {
      backgroundImage: `url("${safeUrl}")`, backgroundSize: "cover",
      backgroundPosition: `center ${posY}%`, backgroundRepeat: "no-repeat",
    };
  }
  return { background: img.value };
}
