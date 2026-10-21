/** Layout-matching skeleton shown while the lazy-loaded picker body
 *  hydrates. Dimensions mirror IconPickerInline so the popover doesn't
 *  shift size when Suspense resolves.
 *
 *  Pure CSS — no animation library dep. The `animate-pulse` utility
 *  comes from Tailwind (used widely elsewhere in the codebase). */
export function PickerSkeleton() {
  return (
    <div className="w-full space-y-3" aria-busy aria-label="Loading icon picker">
      {/* Toolbar row */}
      <div className="flex items-center gap-2">
        <div className="h-8 w-24 rounded bg-muted/60 animate-pulse" />
        <div className="ml-auto h-8 w-20 rounded bg-muted/60 animate-pulse" />
      </div>

      {/* Color row */}
      <div className="flex items-center gap-1.5">
        <div className="h-3 w-10 rounded bg-muted/40 animate-pulse" />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-5 w-5 rounded-full bg-muted/60 animate-pulse" />
        ))}
      </div>

      {/* Search box */}
      <div className="h-8 w-full rounded bg-muted/40 animate-pulse" />

      {/* Grid sections */}
      <div className="space-y-3 overflow-hidden" style={{ height: "16rem" }}>
        {Array.from({ length: 3 }).map((_, sec) => (
          <div key={sec} className="space-y-1">
            <div className="h-3 w-20 rounded bg-muted/40 animate-pulse" />
            <div className="grid grid-cols-8 gap-1">
              {Array.from({ length: 24 }).map((_, i) => (
                <div
                  key={i}
                  className="h-8 w-8 rounded bg-muted/50 animate-pulse"
                  style={{ animationDelay: `${(sec * 24 + i) * 8}ms` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
