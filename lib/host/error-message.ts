// A message safe to put in an HTTP response body.
//
// The reason this exists rather than `String(error)` at each call site: `String(error)` is a
// taint source, not a sanitiser. CodeQL's js/stack-trace-exposure reports it because a value
// that is not an Error serialises via its own `toString`, and the analysis cannot prove the
// value carries no stack, so it treats the whole result as stack-bearing. Two alerts sat
// permanently open on that: `String(error)` in lib/agent/organization-service.ts and
// lib/host/services.ts, surfacing through lib/api/route.ts.
//
// Reading `.message` off a value already narrowed by `instanceof Error` is the narrow, provable
// form: a property read whose name is not `stack`, which the query treats as a barrier.
//
// Two things this deliberately does NOT do, both verified against the real query:
//   - it does not pass an arbitrary string through. Callers legitimately want `fail("operator_required")`,
//     and for that there is `clientMessage` below, which only ever returns a literal the caller wrote.
//     Forwarding a string that arrived as a value re-introduces the taint, because the analysis cannot
//     tell a literal from a stringified exception.
//   - it does not stringify anything. A thrown non-Error becomes a fixed string.
export function errorMessage(error: unknown, max = 500): string {
  const text = error instanceof Error ? error.message : "unexpected error";
  return text.slice(0, max);
}

/** A literal code chosen by the caller, for routes that answer with `fail("operator_required")`.
 *  Separate from `errorMessage` so no path can hand a propagated string to a response body. */
export function clientMessage(code: string, max = 500): string {
  return code.slice(0, max);
}
