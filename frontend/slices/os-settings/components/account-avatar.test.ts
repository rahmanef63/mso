import { describe, expect, it } from "vitest";
import { libraryValueFromPicker, pickerValueFromLibrary } from "./account-avatar";

// The picker speaks bare emoji (`🎯`, `🎯?c=0b6e99`) and namespaced
// `lucide:`/`phosphor:`. The account store speaks `emoji:`/`lucide:`/`phosphor:`
// only. A mismatch here means a picked emoji is rejected by the trust boundary.
describe("picker/account icon value translation", () => {
  it("namespaces bare emoji without touching named icons", () => {
    expect(libraryValueFromPicker("🎯")).toBe("emoji:🎯");
    expect(libraryValueFromPicker("🎯?c=0b6e99")).toBe("emoji:🎯?c=0b6e99");
    expect(libraryValueFromPicker("lucide:Star")).toBe("lucide:Star");
    expect(libraryValueFromPicker("phosphor:Shield?c=ff0000")).toBe("phosphor:Shield?c=ff0000");
    expect(libraryValueFromPicker("emoji:🎯")).toBe("emoji:🎯");
    expect(libraryValueFromPicker("")).toBe("");
  });

  it("round-trips every value the picker can produce back through the store", () => {
    for (const picked of ["🎯", "🦊?c=f59e0b", "lucide:Star", "lucide:FileText?c=0b6e99", "phosphor:ShieldCheck"]) {
      const stored = libraryValueFromPicker(picked);
      expect(pickerValueFromLibrary(stored)).toBe(picked);
    }
    expect(pickerValueFromLibrary(null)).toBeNull();
  });
});
