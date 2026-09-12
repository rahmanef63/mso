const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
type Binding = { path: string[]; header: string; type: string };
export function mcpHeaderValue(value: string): string {
  return /^[\x20-\x7e\t]*$/.test(value) && value.trim() === value && !(value.startsWith("=?base64?") && value.endsWith("?="))
    ? value : "=?base64?" + Buffer.from(value).toString("base64") + "?=";
}
export function mcpHeaderBindings(schema: unknown): Binding[] {
  const out: Binding[] = [], names = new Set<string>();
  function walk(value: unknown, route: string[] | null, depth: number) {
    if (depth > 48) throw new Error("MCP input schema exceeds header inspection depth");
    if (!object(value)) { if (Array.isArray(value)) value.forEach(v => walk(v, null, depth + 1)); return; }
    if (Object.hasOwn(value, "x-mcp-header")) {
      const header = value["x-mcp-header"];
      if (!route?.length || typeof header !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header) || names.has(header.toLowerCase()) ||
        !["string", "integer", "boolean"].includes(String(value.type))) throw new Error("invalid x-mcp-header annotation");
      names.add(header.toLowerCase()); out.push({ path: route, header: "Mcp-Param-" + header, type: String(value.type) });
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "properties" && object(child)) {
        for (const [property, spec] of Object.entries(child)) walk(spec, route ? [...route, property] : null, depth + 1);
      } else if (key !== "x-mcp-header") walk(child, null, depth + 1);
    }
  }
  walk(schema, [], 0); return out;
}
export function mcpArgumentHeaders(bindings: Binding[], args: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const binding of bindings) {
    let value = args;
    for (const key of binding.path) { value = object(value) && Object.hasOwn(value, key) ? value[key] : undefined; }
    if (value === undefined) continue;
    if (binding.type === "integer" ? typeof value !== "number" || !Number.isSafeInteger(value) : typeof value !== binding.type) throw new Error("invalid MCP header parameter: " + binding.path.join("."));
    headers[binding.header] = mcpHeaderValue(String(value));
  }
  return headers;
}
