import { describe, expect, it } from "vite-plus/test";
import { isLocalSource, maskComments, parseImports } from "./parseImports.ts";

describe("parseImports", () => {
  it("lists default, namespace, named and type imports in source order", () => {
    const code = [
      `import React, { useState as useS, type FC } from "react";`,
      `import * as path from 'node:path';`,
      `import type { Metadata } from "next";`,
      `import {`,
      `  Button,`,
      `  Card,`,
      `} from "@/components/ui";`,
    ].join("\n");

    expect(parseImports(code)).toEqual([
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
    const code = [
      `import "./globals.css";`,
      `export { default } from "./Layout";`,
      `export * as utils from "../utils";`,
      `const Chart = dynamic(() => import("./Chart"), { ssr: false });`,
    ].join("\n");

    expect(
      parseImports(code).map(({ source, kind, names, line }) => [source, kind, names, line]),
    ).toEqual([
      ["./globals.css", "side-effect", [], 1],
      ["./Layout", "re-export", ["default"], 2],
      ["../utils", "re-export", ["* as utils"], 3],
      ["./Chart", "dynamic", [], 4],
    ]);
  });

  it("ignores commented-out imports", () => {
    const code = [
      `// import Old from "old";`,
      `/*`,
      `import Gone from "gone";`,
      `*/`,
      `import Kept from "kept"; // trailing comment`,
    ].join("\n");

    expect(parseImports(code).map((entry) => [entry.source, entry.line])).toEqual([["kept", 5]]);
  });

  it("returns nothing for a file without imports", () => {
    expect(parseImports(`export default function Page() { return null; }`)).toEqual([]);
  });
});

describe("maskComments", () => {
  it("leaves comment-like text inside strings, templates and regexes alone", () => {
    const code = [
      `const url = "https://example.com"; // gone`,
      "const t = `a ${b /* gone */} //kept`;",
      `const re = /\\/\\/kept/;`,
    ].join("\n");

    const masked = maskComments(code);
    expect(masked).toContain(`"https://example.com"`);
    expect(masked).not.toContain("gone");
    expect(masked).toContain("//kept`");
    expect(masked).toContain(`/\\/\\/kept/`);
    expect(masked.length).toBe(code.length);
  });

  it("doesn't let an apostrophe in JSX text swallow later lines", () => {
    const code = [`<p>Don't panic</p>`, `{/* hidden */}`].join("\n");
    expect(maskComments(code)).not.toContain("hidden");
  });
});

describe("isLocalSource", () => {
  it("treats relative paths and aliases as local, packages as external", () => {
    expect(["./a", "../b", "@/c", "~/d", "#e"].every(isLocalSource)).toBe(true);
    expect(["react", "@scope/pkg", "node:fs"].some(isLocalSource)).toBe(false);
  });
});
