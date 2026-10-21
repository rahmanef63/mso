import { Smile, Shapes, Trash2, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Top tabs. MSO's tabs primitive is presentational — the parent owns `tab`
 *  and passes `onTabChange`, so there is no radix context to depend on. */
export function PickerToolbar({
  tab, onTabChange, onRandom, onClear,
}: {
  tab: "emoji" | "icon";
  onTabChange: (next: "emoji" | "icon") => void;
  onRandom: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <TabsList className="h-8">
        <TabsTrigger active={tab === "emoji"} onClick={() => onTabChange("emoji")} className="h-7 text-xs gap-1">
          <Smile className="h-3.5 w-3.5" /> Emoji
        </TabsTrigger>
        <TabsTrigger active={tab === "icon"} onClick={() => onTabChange("icon")} className="h-7 text-xs gap-1">
          <Shapes className="h-3.5 w-3.5" /> Icon
        </TabsTrigger>
      </TabsList>
      <div className="ml-auto flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onRandom}
          title="Random"
        >
          <Shuffle className="h-3.5 w-3.5" />
        </Button>
        {onClear && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={onClear}
            title="Remove icon"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Variant pills shown under the top tabs. Two values per tab:
 *  - emoji tab → "native" | "twemoji"
 *  - icon tab  → "lucide" | "phosphor"  */
export function VariantPills<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
}) {
  return (
    <div className="flex h-7 w-full items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Button
            key={opt.value}
            type="button"
            variant="ghost"
            onClick={() => onChange(opt.value)}
            title={opt.hint}
            className={
              "flex h-auto h-6 flex-1 items-center justify-center rounded-[5px] px-2 text-[11px] font-medium transition " +
              (active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}
