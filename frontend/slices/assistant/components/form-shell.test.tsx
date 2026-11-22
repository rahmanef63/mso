import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Field } from "./form-shell";

describe("assistant form field", () => {
  it("associates each control with a unique label and hint", () => {
    const html = renderToStaticMarkup(<><Field label="Name" hint="A name"><input /></Field><Field label="Name" hint="Another name"><input /></Field></>);
    const labels = [...html.matchAll(/<label for="([^"]+)"/g)].map((match) => match[1]);
    const inputs = [...html.matchAll(/<input id="([^"]+)" aria-describedby="([^"]+)"/g)];
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    expect(inputs.map((match) => match[1])).toEqual(labels);
    for (const match of inputs) expect(html).toContain(`id="${match[2]}"`);
  });

  it("groups non-control pickers without wrapping interactive children in a label", () => {
    const html = renderToStaticMarkup(<Field label="Icon"><button>Pick</button></Field>);
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).not.toContain("<label");
  });
});
