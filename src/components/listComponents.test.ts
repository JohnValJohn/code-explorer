import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vite-plus/test";
import { isLocalSource, listComponents } from "./listComponents.ts";

function componentsOf(lines: string[]) {
  const code = lines.join("\n");
  const { program, module } = parseSync("page.tsx", code);
  return listComponents(program, module, code);
}

describe("listComponents", () => {
  it("lists rendered components in order of first render, with their import source", () => {
    expect(
      componentsOf([
        `import { Button as Btn, Card } from "@/components/ui";`,
        `import * as UI from "./ui";`,
        `import Hero from "./Hero";`,
        `import Unused from "./Unused";`,
        `import { useState } from "react";`,
        `export default function Page() {`,
        `  return (`,
        `    <Card>`,
        `      <Btn />`,
        `      <Hero />`,
        `      <UI.Dialog.Title>Hi</UI.Dialog.Title>`,
        `      <Btn />`,
        `    </Card>`,
        `  );`,
        `}`,
      ]),
    ).toEqual([
      {
        name: "Card",
        import: { source: "@/components/ui", importedName: "Card" },
        count: 1,
        line: 8,
      },
      {
        name: "Btn",
        import: { source: "@/components/ui", importedName: "Button" },
        count: 2,
        line: 9,
      },
      { name: "Hero", import: { source: "./Hero", importedName: "default" }, count: 1, line: 10 },
      {
        name: "UI.Dialog.Title",
        import: { source: "./ui", importedName: "*" },
        count: 1,
        line: 11,
      },
    ]);
  });

  it("ignores intrinsic elements, fragments and components that aren't imported", () => {
    expect(
      componentsOf([
        `import { Kept } from "./Kept";`,
        `import type { Typed } from "./Typed";`,
        `const Local = () => <span />;`,
        `export default function Page() {`,
        `  return <><div><svg:rect /><Local /><Typed /><Kept /></div></>;`,
        `}`,
      ]).map((component) => component.name),
    ).toEqual(["Kept"]);
  });

  it("finds components nested in props and callbacks", () => {
    expect(
      componentsOf([
        `import { List, Item, Icon } from "lib";`,
        `export default function Page({ items }) {`,
        `  return <List icon={<Icon />}>{items.map((i) => <Item key={i} />)}</List>;`,
        `}`,
      ]).map((component) => component.name),
    ).toEqual(["List", "Icon", "Item"]);
  });

  it("returns nothing for a file without JSX", () => {
    expect(componentsOf([`import React from "react";`, `export const x = 1;`])).toEqual([]);
  });
});

describe("isLocalSource", () => {
  it("treats relative paths and aliases as local, packages as external", () => {
    expect(["./a", "../b", "@/c", "~/d", "#e"].every(isLocalSource)).toBe(true);
    expect(["react", "@scope/pkg", "node:fs"].some(isLocalSource)).toBe(false);
  });
});
