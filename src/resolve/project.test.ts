import { describe, expect, it } from "vite-plus/test";
import { createProject } from "./project.ts";

function projectOf(files: Record<string, string>) {
  return createProject(async (path) => files[path] ?? null);
}

async function locateAll(files: Record<string, string>, importer: string) {
  const project = projectOf(files);
  const { components } = await project.listComponents(importer);
  return Object.fromEntries(
    await Promise.all(
      components.map(async (component) => [
        component.name,
        await project.locate(importer, component),
      ]),
    ),
  );
}

describe("createProject", () => {
  it("resolves relative imports, extensions and index files", async () => {
    expect(
      await locateAll(
        {
          "app/home/page.tsx": [
            `import Hero from "./Hero";`,
            `import { Card } from "../shared/Card.js";`,
            `import { Nav } from "../nav";`,
            `export default () => <><Hero /><Card /><Nav /></>;`,
          ].join("\n"),
          "app/home/Hero.tsx": `export default function Hero() {}`,
          "app/shared/Card.tsx": `export function Card() {}`,
          "app/nav/index.ts": `export function Nav() {}`,
        },
        "app/home/page.tsx",
      ),
    ).toEqual({
      Hero: { kind: "file", path: "app/home/Hero.tsx" },
      Card: { kind: "file", path: "app/shared/Card.tsx" },
      Nav: { kind: "file", path: "app/nav/index.ts" },
    });
  });

  it("maps @/ to src/ in the nearest package", async () => {
    expect(
      await locateAll(
        {
          "package.json": "{}",
          "apps/web/package.json": "{}",
          "apps/web/src/app/page.tsx": `import { Button } from "@/ui/Button";\nexport default () => <Button />;`,
          "apps/web/src/ui/Button.tsx": `export const Button = () => null;`,
        },
        "apps/web/src/app/page.tsx",
      ),
    ).toEqual({ Button: { kind: "file", path: "apps/web/src/ui/Button.tsx" } });
  });

  it("follows barrel re-exports to the defining file", async () => {
    expect(
      await locateAll(
        {
          "page.tsx": [
            `import { Button, Card, Dialog, Plain } from "./ui";`,
            `import * as UI from "./ui";`,
            `export default () => <><Button /><Card /><Dialog /><Plain /><UI.Card /></>;`,
          ].join("\n"),
          "ui/index.ts": [
            `export { default as Button } from "./Button";`,
            `import { Card } from "./card";`,
            `export { Card };`,
            `export * from "./dialog";`,
            `export function Plain() {}`,
          ].join("\n"),
          "ui/Button.tsx": `export default function Button() {}`,
          "ui/card/index.ts": `export * from "./Card";`,
          "ui/card/Card.tsx": `export const Card = () => null;`,
          "ui/dialog.tsx": `export const Dialog = () => null;`,
        },
        "page.tsx",
      ),
    ).toEqual({
      Button: { kind: "file", path: "ui/Button.tsx" },
      Card: { kind: "file", path: "ui/card/Card.tsx" },
      Dialog: { kind: "file", path: "ui/dialog.tsx" },
      Plain: { kind: "file", path: "ui/index.ts" },
      "UI.Card": { kind: "file", path: "ui/card/Card.tsx" },
    });
  });

  it("distinguishes packages from local imports it can't resolve", async () => {
    expect(
      await locateAll(
        {
          "page.tsx": [
            `import { Slot } from "@radix-ui/react-slot";`,
            `import { Gone } from "./Gone";`,
            `import { Aliased } from "~/Aliased";`,
            `import { Cyclic } from "./cyclic";`,
            `export default () => <><Slot /><Gone /><Aliased /><Cyclic /></>;`,
          ].join("\n"),
          "cyclic.ts": `export * from "./cyclic2";`,
          "cyclic2.ts": `export * from "./cyclic";`,
        },
        "page.tsx",
      ),
    ).toEqual({
      Slot: { kind: "package" },
      Gone: { kind: "unresolved" },
      Aliased: { kind: "unresolved" },
      // The export isn't found, so it falls back to the imported module.
      Cyclic: { kind: "file", path: "cyclic.ts" },
    });
  });
});
