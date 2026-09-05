import { parse, type DefaultTreeAdapterTypes } from "parse5";

// Parse generated HTML as a browser does. This is test extraction, not an HTML sanitizer.
export function inlineScripts(html: string): string[] {
  const scripts: string[] = [];
  const walk = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node && node.tagName === "script" && !node.attrs.some((attr) => attr.name === "src")) {
      scripts.push(node.childNodes.map((child) => "value" in child ? child.value : "").join(""));
    }
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(parse(html));
  return scripts;
}
