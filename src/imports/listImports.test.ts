import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vite-plus/test";
import { isLocalSource, listImports } from "./listImports.ts";

function importsOf(lines: string[]) {
  const code = lines.join("\n");
  return listImports(parseSync("page.tsx", code).module, code);
}

describe("listImports", () => {
  it("lists default, namespace, named and type imports in source order", () => {
    expect(
      importsOf([
        `import React, { useState as useS, type FC } from "react";`,
        `import * as path from 'node:path';`,
        `import type { Metadata } from "next";`,
        `import {`,
        `  Button,`,
        `  Card,`,
        `} from "@/components/ui";`,
      ]),
    ).toEqual([
      {
        source: "react",
        kind: "static",
        typeOnly: false,
        names: ["React", "useState as useS", "type FC"],
        line: 1,
      },
      { source: "node:path", kind: "static", typeOnly: false, names: ["* as path"], line: 2 },
      { source: "next", kind: "static", typeOnly: true, names: ["Metadata"], line: 3 },
      {
        source: "@/components/ui",
        kind: "static",
        typeOnly: false,
        names: ["Button", "Card"],
        line: 4,
      },
    ]);
  });

  it("finds side-effect imports, re-exports and dynamic imports", () => {
    expect(
      importsOf([
        `import "./globals.css";`,
        `export { default, Header as Top } from "./Layout";`,
        `export * as utils from "../utils";`,
        `export type * from "./types";`,
        `const Chart = dynamic(() => import("./Chart"), { ssr: false });`,
        "const messages = await import(`./locales/${lang}.json`);",
      ]).map(({ source, kind, typeOnly, names, line }) => [source, kind, typeOnly, names, line]),
    ).toEqual([
      ["./globals.css", "side-effect", false, [], 1],
      ["./Layout", "re-export", false, ["default", "Header as Top"], 2],
      ["../utils", "re-export", false, ["* as utils"], 3],
      ["./types", "re-export", true, ["*"], 4],
      ["./Chart", "dynamic", false, [], 5],
      ["`./locales/${lang}.json`", "dynamic", false, [], 6],
    ]);
  });

  it("ignores comments, strings and local exports", () => {
    expect(
      importsOf([
        `// import Old from "old"; — café`,
        `/* import Gone from "gone"; */`,
        `const text = 'import Fake from "fake"';`,
        `export const answer = 42;`,
        `import Kept from "kept";`,
        `export default function Page() { return <p>Don't import "x"</p>; }`,
      ]).map((entry) => [entry.source, entry.line]),
    ).toEqual([["kept", 5]]);
  });

  it("returns nothing for a file without imports", () => {
    expect(importsOf([`export default function Page() { return null; }`])).toEqual([]);
  });
});

describe("isLocalSource", () => {
  it("treats relative paths and aliases as local, packages as external", () => {
    expect(["./a", "../b", "@/c", "~/d", "#e"].every(isLocalSource)).toBe(true);
    expect(["react", "@scope/pkg", "node:fs"].some(isLocalSource)).toBe(false);
  });
});
