import { describe, expect, it } from "vitest";
import { filterPickerItems, nextPickerIndex, parsePickerItems, pickerWindow } from "./mso-tui-select.mjs";

const rows = parsePickerItems([
  "gpt-5.6-sol\tgpt-5.6-sol\tcurrent model\tcurrent",
  "gpt-5.6-terra\tgpt-5.6-terra\treasoning\t",
  "gpt-5.6-luna\tgpt-5.6-luna\tfast\t",
].join("\n"));

describe("MSO native TUI picker", () => {
  it("parses value/label/meta/state rows without numeric choice semantics", () => {
    expect(rows[0]).toEqual({ value: "gpt-5.6-sol", label: "gpt-5.6-sol", meta: "current model", state: "current" });
  });

  it("filters by labels, values, and metadata", () => {
    expect(filterPickerItems(rows, "terra").map((row: { value: string }) => row.value)).toEqual(["gpt-5.6-terra"]);
    expect(filterPickerItems(rows, "fast").map((row: { value: string }) => row.value)).toEqual(["gpt-5.6-luna"]);
  });

  it("wraps arrow selection and keeps the selected row visible", () => {
    expect(nextPickerIndex(3, 0, -1)).toBe(2);
    expect(nextPickerIndex(3, 2, 1)).toBe(0);
    const many = Array.from({ length: 14 }, (_, index) => ({ value: String(index), label: String(index), meta: "", state: "" }));
    const window = pickerWindow(many, 11, 8);
    expect(window.start).toBeGreaterThan(0);
    expect(window.rows.some((row: { value: string }) => row.value === "11")).toBe(true);
  });
});
