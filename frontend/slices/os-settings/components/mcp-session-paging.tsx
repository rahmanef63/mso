"use client";
import { Button } from "@/components/ui/button";
export function SessionPaging({ page, pages, total, label, onPage }: {
  page: number; pages: number; total: number; label: string; onPage: (page: number) => void;
}) {
  return <nav aria-label={label + " pagination"} className="flex flex-wrap items-center justify-between gap-2">
    <Button variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={`Previous ${label.toLowerCase()} page`}>Previous</Button>
    <span role="status" className="text-xs text-muted-foreground">Page {page} of {pages} · {total} {label.toLowerCase()}</span>
    <Button variant="outline" className="min-h-11" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={`Next ${label.toLowerCase()} page`}>Next</Button>
  </nav>;
}
export function sessionTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}
