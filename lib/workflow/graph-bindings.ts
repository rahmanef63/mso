import { graphObject } from "./graph-schema";
export function workflowPath(root: unknown, ref: string): unknown {
  const parts = ref.split(".");
  if (!parts.length || parts.length > 16 || parts.some((part) => !/^[A-Za-z0-9_:-]+$/.test(part) || ["__proto__", "constructor", "prototype"].includes(part))) throw new Error("invalid workflow reference");
  let value = root;
  for (const part of parts) {
    if ((!graphObject(value) && !Array.isArray(value)) || !Object.hasOwn(value, part)) throw new Error(`unresolved workflow reference: ${ref}`);
    value = (value as Record<string, unknown>)[part];
  }
  return structuredClone(value);
}
export function bindWorkflowValue(value: unknown, context: unknown, variables: Record<string, unknown>, depth = 0): unknown {
  if (depth > 14) throw new Error("workflow references too deep");
  if (Array.isArray(value)) return value.map((item) => bindWorkflowValue(item, context, variables, depth + 1));
  if (!graphObject(value)) return value;
  if (Object.hasOwn(value, "$ref")) {
    if (Object.keys(value).length !== 1 || typeof value.$ref !== "string") throw new Error("workflow $ref must be the whole value");
    return workflowPath(context, value.$ref);
  }
  if (Object.hasOwn(value, "$var")) {
    if (Object.keys(value).length !== 1 || typeof value.$var !== "string") throw new Error("workflow $var must be the whole value");
    if (!Object.hasOwn(variables, value.$var)) throw new Error(`workflow variable not found: ${value.$var}`);
    return structuredClone(variables[value.$var]);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, bindWorkflowValue(child, context, variables, depth + 1)]));
}
export function bindLoopItem(value: unknown, item: unknown, index: number, depth = 0): unknown {
  if (depth > 14) throw new Error("loop bindings too deep");
  if (Array.isArray(value)) return value.map((child) => bindLoopItem(child, item, index, depth + 1));
  if (!graphObject(value)) return value;
  if (Object.hasOwn(value, "$item")) {
    if (Object.keys(value).length !== 1) throw new Error("$item must be the whole value");
    if (value.$item === true || value.$item === "") return structuredClone(item);
    if (typeof value.$item !== "string") throw new Error("invalid $item binding");
    return workflowPath({ item }, `item.${value.$item}`);
  }
  if (Object.hasOwn(value, "$index")) return index;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, bindLoopItem(child, item, index, depth + 1)]));
}
