import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ICON_COLORS } from "../../lib/colors";

export function ColorRow({
  currentColor, onPick,
}: {
  currentColor: string | undefined;
  onPick: (hex: string) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Color</span>
      {ICON_COLORS.map((c) => {
        const isSelected =
          (c.hex === "" && !currentColor) ||
          (c.hex !== "" && currentColor?.toLowerCase() === c.hex.toLowerCase());
        return (
          <Button
            key={c.id}
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onPick(c.hex)}
            className={cn(
              "h-5 w-5 rounded-full border p-0",
              isSelected ? "ring-2 ring-primary/60 ring-offset-2 ring-offset-background" : "",
            )}
            style={{
              backgroundColor: c.hex || "transparent",
              borderColor: c.hex ? c.hex : "var(--border)",
            }}
            title={c.label}
            aria-label={`Color: ${c.label}`}
          >
            {!c.hex && <span className="block text-[10px] leading-none">∅</span>}
          </Button>
        );
      })}
    </div>
  );
}
