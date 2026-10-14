import { describe, expect, it } from "vite-plus/test";
import { scanRepository } from "./scanPages.ts";

type Tree = { [name: string]: Tree | "file" };

function fakeDirectory(name: string, tree: Tree): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *values() {
      for (const [childName, child] of Object.entries(tree)) {
        yield child === "file"
          ? { kind: "file", name: childName }
          : fakeDirectory(childName, child);
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("scanPages", () => {
  it("collects page.tsx paths relative to the root, sorted", async () => {
    const root = fakeDirectory("repo", {
      "page.tsx": "file",
      app: {
        settings: { "page.tsx": "file", "layout.tsx": "file" },
        about: { "page.tsx": "file", "Page.tsx": "file", "homepage.tsx": "file" },
      },
    });

    expect((await scanRepository(root)).pages).toEqual([
      "app/about/page.tsx",
      "app/settings/page.tsx",
      "page.tsx",
    ]);
  });

  it("skips dependency, build and hidden folders", async () => {
    const root = fakeDirectory("repo", {
      node_modules: { pkg: { "page.tsx": "file" } },
      dist: { "page.tsx": "file" },
      ".next": { "page.tsx": "file" },
      ".git": { "page.tsx": "file" },
      src: { "page.tsx": "file" },
    });

    expect((await scanRepository(root)).pages).toEqual(["src/page.tsx"]);
  });

  it("collects package folders", async () => {
    const root = fakeDirectory("repo", {
      "package.json": "file",
      packages: { ui: { "package.json": "file", src: {} }, docs: { "README.md": "file" } },
      node_modules: { react: { "package.json": "file" } },
    });

    expect((await scanRepository(root)).packageDirs).toEqual(["", "packages/ui"]);
  });
});
