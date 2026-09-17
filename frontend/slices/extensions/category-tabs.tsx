"use client";
import { Button } from "@/components/ui/button";
export function CategoryTabs({ id, label, items, value, onChange }: { id: string; label: string; items: readonly { id: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 rounded-lg bg-secondary p-1">{items.map((item, index) => <Button key={item.id} id={`${id}-${item.id}`} role="tab" aria-selected={item.id === value} aria-controls={`${id}-panel`} tabIndex={item.id === value ? 0 : -1}
    type="button" size="sm" variant={item.id === value ? "default" : "ghost"} onClick={() => onChange(item.id)} onKeyDown={event => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowRight" ? (index + 1) % items.length : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length : -1;
      if (next < 0) return; event.preventDefault(); onChange(items[next].id); document.getElementById(`${id}-${items[next].id}`)?.focus();
    }}>{item.label}</Button>)}</div>;
}
