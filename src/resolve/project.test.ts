import { describe, expect, it } from "vite-plus/test";
import { createProject } from "./project.ts";

function projectOf(files: Record<string, string>) {
  const packageDirs = Object.keys(files)
    .filter((path) => path === "package.json" || path.endsWith("/package.json"))
    .map((path) => path.slice(0, -"package.json".length).replace(/\/$/, ""));
  return createProject(async (path) => files[path] ?? null, packageDirs);
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

  it("resolves # imports through the nearest package.json's imports field", async () => {
    expect(
      await locateAll(
        {
          "apps/web/package.json": JSON.stringify({
            imports: { "#scr/*": "./src/*", "#ui": "./src/ui/index.ts" },
          }),
          "apps/web/src/app/page.tsx": [
            `import { Hero } from "#scr/app/Hero";`,
            `import { Card } from "#ui";`,
            `import { Nope } from "#other/Nope";`,
            `export default () => <><Hero /><Card /><Nope /></>;`,
          ].join("\n"),
          "apps/web/src/app/Hero/index.tsx": `export const Hero = () => null;`,
          "apps/web/src/ui/index.ts": `export { Card } from "./Card";`,
          "apps/web/src/ui/Card.tsx": `export const Card = () => null;`,
        },
        "apps/web/src/app/page.tsx",
      ),
    ).toEqual({
      Hero: { kind: "file", path: "apps/web/src/app/Hero/index.tsx" },
      Card: { kind: "file", path: "apps/web/src/ui/Card.tsx" },
      Nope: { kind: "unresolved" },
    });
  });

  it("resolves imports of the repo's other packages", async () => {
    expect(
      await locateAll(
        {
          "apps/web/package.json": JSON.stringify({ name: "@sorare/web" }),
          "apps/web/src/page.tsx": [
            `import { Button } from "@sorare/ui/components/Button";`,
            `import { Card } from "@sorare/ui";`,
            `import { Chart } from "@sorare/charts/Chart";`,
            `import { Legacy } from "@sorare/legacy/Legacy";`,
            `import { Gone } from "@sorare/legacy/Gone";`,
            `import { Slot } from "@sorare/external";`,
            `export default () => <><Button /><Card /><Chart /><Legacy /><Gone /><Slot /></>;`,
          ].join("\n"),
          // `exports` patterns, pointing at sources (the `types` target is skipped).
          "packages/ui/package.json": JSON.stringify({
            name: "@sorare/ui",
            exports: {
              ".": "./src/index.ts",
              "./*": { types: "./dist/*.d.ts", default: "./src/*.tsx" },
            },
          }),
          "packages/ui/src/index.ts": `export * from "./components/Card";`,
          "packages/ui/src/components/Button.tsx": `export const Button = () => null;`,
          "packages/ui/src/components/Card.tsx": `export const Card = () => null;`,
          // No `exports`: files under src/.
          "packages/charts/package.json": JSON.stringify({ name: "@sorare/charts" }),
          "packages/charts/src/Chart.tsx": `export const Chart = () => null;`,
          // No `exports`: files at the package root.
          "packages/legacy/package.json": JSON.stringify({ name: "@sorare/legacy" }),
          "packages/legacy/Legacy.jsx": `export const Legacy = () => null;`,
        },
        "apps/web/src/page.tsx",
      ),
    ).toEqual({
      Button: { kind: "file", path: "packages/ui/src/components/Button.tsx" },
      Card: { kind: "file", path: "packages/ui/src/components/Card.tsx" },
      Chart: { kind: "file", path: "packages/charts/src/Chart.tsx" },
      Legacy: { kind: "file", path: "packages/legacy/Legacy.jsx" },
      // In the repo but missing, as opposed to a package from npm.
      Gone: { kind: "unresolved" },
      Slot: { kind: "package" },
    });
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

describe("resolveRoute", () => {
  async function routesOf(files: Record<string, string>, importer: string) {
    const project = projectOf(files);
    const { components } = await project.listComponents(importer);
    return Promise.all(
      components.map((component) =>
        component.navigateTo === null && component.routeReferences
          ? project.resolveRoute(importer, component.routeReferences)
          : Promise.resolve(component.navigateTo),
      ),
    );
  }

  it("finds the routes.ts constant a Navigate's to is built from", async () => {
    expect(
      await routesOf(
        {
          "package.json": `{}`,
          "src/constants/routes.ts": [
            `const BASE = "/football";`,
            `export const PLAYER = \`\${BASE}/players/:slug\`;`,
            `export const ROUTES = { club: { show: "/clubs/:id" } } as const;`,
            `export const HOME = "/";`,
          ].join("\n"),
          "src/constants/index.ts": `export * from "./routes";`,
          "src/lib/generatePath.ts": `export const generatePath = (p, params) => p;`,
          "src/app/page.tsx": [
            `import { Navigate } from "react-router";`,
            `import { generatePath } from "@/lib/generatePath";`,
            `import { PLAYER, ROUTES } from "@/constants";`,
            `import * as routes from "../constants/routes";`,
            `import { HOME as START } from "../constants/routes";`,
            `export default function Page({ slug, id, other }) {`,
            `  const url = generatePath(ROUTES.club.show, { id });`,
            `  if (slug) return <Navigate to={generatePath(PLAYER, { slug })} />;`,
            `  if (id) return <Navigate to={url} />;`,
            `  if (other) return <Navigate to={other} />;`,
            `  return <><Navigate to={routes.HOME} /><Navigate to={START} /></>;`,
            `}`,
          ].join("\n"),
        },
        "src/app/page.tsx",
      ),
    ).toEqual(["/football/players/:slug", "/clubs/:id", null, "/", "/"]);
  });

  it("ignores constants outside routes files", async () => {
    expect(
      await routesOf(
        {
          "app/paths.ts": `export const HOME = "/";`,
          "app/page.tsx": [
            `import { Navigate } from "./Navigate";`,
            `import { HOME } from "./paths";`,
            `export default () => <Navigate to={HOME} />;`,
          ].join("\n"),
        },
        "app/page.tsx",
      ),
    ).toEqual([null]);
  });
});

describe("dialogs", () => {
  const registry = "packages/gameplay/src/contexts/dialogs/index.tsx";
  const files = {
    [registry]: [
      `import { Suspense } from "react";`,
      `import { DialogKey, WithDialogs } from "../../WithDialogs";`,
      `import { lazy } from "../../retry";`,
      `import { CardPage } from "../../CardPage";`,
      `import { NewsDialog } from "../../NewsDialog";`,
      `const PackDialog = lazy(async () => import("../../PackDialog"), "PackDialog");`,
      `const RoutedPackDialog = () => <PackDialog open />;`,
      `const RoutedNewsDialog = () => <NewsDialog />;`,
      `export const DialogsProvider = ({ children }) => (`,
      `  <WithDialogs dialogs={[`,
      `    { name: DialogKey.card, element: <Suspense><CardPage /></Suspense> },`,
      `    { name: DialogKey.packDetails, element: <RoutedPackDialog /> },`,
      `    { name: DialogKey.news, element: <Suspense><RoutedNewsDialog /></Suspense> },`,
      `  ]}>{children}</WithDialogs>`,
      `);`,
    ].join("\n"),
    "packages/gameplay/src/PackDialog.tsx": `export const PackDialog = () => null;`,
    "packages/football/src/pages/index.tsx": `export default () => <WithDialogs dialogs={[{ name: DialogKey.game, element: <Game /> }]} />;`,
    "packages/nba/src/pages/index.tsx": `export default () => <WithDialogs dialogs={[{ name: DialogKey.game, element: <Game /> }]} />;`,
  };

  it("finds the registry with a dialog for a key", async () => {
    const project = projectOf(files);
    expect(await project.findDialog("card")).toBe(registry);
    expect(await project.findDialog("missing")).toBe(null);
  });

  it("prefers the registry of the caller's package, then the page's", async () => {
    const project = projectOf(files);
    const nba = "packages/nba/src/pages/index.tsx";
    const football = "packages/football/src/pages/index.tsx";
    expect(await project.findDialog("game")).toBe(football);
    expect(await project.findDialog("game", ["packages/nba/src/A.tsx"])).toBe(nba);
    expect(
      await project.findDialog("game", [
        "packages/gameplay/src/A.tsx",
        "packages/nba/src/pages/x/page.tsx",
      ]),
    ).toBe(nba);
    // The caller's own package wins over the page's.
    expect(await project.findDialog("card", ["packages/gameplay/src/A.tsx", nba])).toBe(registry);
  });

  it("lists what a dialog renders, through local and lazy components", async () => {
    const project = projectOf(files);
    const { components } = await project.listDialogComponents(registry, "packDetails");
    expect(components.map(({ name }) => name)).toEqual(["PackDialog"]);
    expect(await project.locate(registry, components[0])).toEqual({
      kind: "file",
      path: "packages/gameplay/src/PackDialog.tsx",
    });
    expect(
      (await project.listDialogComponents(registry, "card")).components.map(({ name }) => name),
    ).toEqual(["Suspense", "CardPage"]);
    // In the order rendered, not the order defined.
    expect(
      (await project.listDialogComponents(registry, "news")).components.map(({ name }) => name),
    ).toEqual(["Suspense", "NewsDialog"]);
  });
});
