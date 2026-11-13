import { describe, expect, it } from "vitest";
import { modelOptionText } from "./ai-model-select";

// Complaint: the model field was free text with a <datalist>, so the saved id
// came from memory. It is a real list now; these pin what each row says so the
// id that gets written to config is always visible next to the friendly name.
describe("model option rows", () => {
  it("shows the id even when a display name exists, because the id is what is saved", () => {
    const text = modelOptionText({ id: "gpt-6.1-sol", name: "GPT 6.1 Sol" });
    expect(text).toContain("GPT 6.1 Sol");
    expect(text).toContain("gpt-6.1-sol");
  });

  it("never duplicates the id when the catalog has no separate name", () => {
    expect(modelOptionText({ id: "cx/gpt-6-astra[1m]" })).toBe("cx/gpt-6-astra[1m] · ctx —");
  });

  it("summarises free, context and capability flags in one line", () => {
    const text = modelOptionText({ id: "free-model", context: 1_000_000, free: true, tools: true, reasoning: true });
    expect(text).toBe("free-model · FREE · ctx 1M · tools · reasoning");
  });

  it("does not claim a context length it does not have", () => {
    expect(modelOptionText({ id: "m", context: undefined })).toContain("ctx —");
    expect(modelOptionText({ id: "m", context: 0 })).toContain("ctx —");
    expect(modelOptionText({ id: "m", context: 128_000 })).toContain("ctx 128K");
  });
});
