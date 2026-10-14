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

describe("listComponents with Navigate", () => {
  it("lists each static target of Navigate separately", () => {
    expect(
      componentsOf([
        `import { Navigate } from "react-router";`,
        `import { Navigate as Redirect } from "@/routing";`,
        `export default function Page({ id, to }) {`,
        `  if (id) return <Navigate to={\`/players/\${id}?tab=\${1}\`} />;`,
        `  if (to) return <Navigate to={to} />;`,
        `  return <><Navigate to="/home" /><Redirect to={{ pathname: "/home" }} /><Navigate to={"/home"} /></>;`,
        `}`,
      ]).map(({ name, navigateTo, count }) => ({ name, navigateTo, count })),
    ).toEqual([
      { name: "Navigate", navigateTo: "/players/:id?tab=:param", count: 1 },
      { name: "Navigate", navigateTo: null, count: 1 },
      { name: "Navigate", navigateTo: "/home", count: 2 },
      { name: "Redirect", navigateTo: "/home", count: 1 },
    ]);
  });
});

describe("listComponents with useNavigate", () => {
  it("lists each navigate() call target, in order with the components", () => {
    expect(
      componentsOf([
        `import { useNavigate as useNav } from "react-router";`,
        `import { Button } from "./Button";`,
        `import { PLAYER } from "@/routes";`,
        `export default function Page({ slug }) {`,
        `  const go = useNav();`,
        `  const back = () => go(-1);`,
        `  return <Button onClick={() => go(\`/players/\${slug}\`, { replace: true })}`,
        `    onBlur={() => go(PLAYER)} onFocus={() => go("/home")} onHover={() => go("/home")} />;`,
        `}`,
      ]).map(({ name, import: { importedName }, navigateTo, routeReferences, count }) => ({
        name,
        importedName,
        navigateTo,
        routeReferences,
        count,
      })),
    ).toEqual([
      {
        name: "Button",
        importedName: "Button",
        navigateTo: undefined,
        routeReferences: undefined,
        count: 1,
      },
      {
        name: "go()",
        importedName: "useNavigate",
        navigateTo: "/players/:slug",
        routeReferences: undefined,
        count: 1,
      },
      {
        name: "go()",
        importedName: "useNavigate",
        navigateTo: null,
        routeReferences: [{ import: { source: "@/routes", importedName: "PLAYER" }, path: [] }],
        count: 1,
      },
      {
        name: "go()",
        importedName: "useNavigate",
        navigateTo: "/home",
        routeReferences: undefined,
        count: 2,
      },
    ]);
  });
});

describe("listComponents with useOpenDialog", () => {
  it("lists each openDialog() call by dialog key", () => {
    expect(
      componentsOf([
        `import { useOpenDialog } from "@sorare/core/src/hooks/navigation/useOpenDialog";`,
        `import { DialogKey } from "@sorare/core/src/components/navigation/WithDialogs";`,
        `export default function Page({ slug, tab }) {`,
        `  const openDialog = useOpenDialog();`,
        `  const open = () => openDialog(DialogKey.card, slug);`,
        `  return <button onClick={() => { openDialog(DialogKey.card, "x"); openDialog(tab, "1"); openDialog("news", "1"); openDialog(); }} />;`,
        `}`,
      ]).map(({ name, dialogKey, count, line }) => ({ name, dialogKey, count, line })),
    ).toEqual([
      { name: "openDialog()", dialogKey: "card", count: 2, line: 5 },
      { name: "openDialog()", dialogKey: null, count: 1, line: 6 },
      { name: "openDialog()", dialogKey: "news", count: 1, line: 6 },
    ]);
  });
});

describe("listComponents with lazy components", () => {
  it("lists them as imports of the module they load", () => {
    expect(
      componentsOf([
        `import { lazy } from "@/lib/retry";`,
        `import React from "react";`,
        `const Dialog = lazy(async () => import("./Dialog"), "Dialog");`,
        `const Other = React.lazy(() => import("./Other"));`,
        `export default () => <><Dialog /><Other /></>;`,
      ]).map(({ name, import: imported }) => ({ name, imported })),
    ).toEqual([
      { name: "Dialog", imported: { source: "./Dialog", importedName: "Dialog" } },
      { name: "Other", imported: { source: "./Other", importedName: "default" } },
    ]);
  });
});
