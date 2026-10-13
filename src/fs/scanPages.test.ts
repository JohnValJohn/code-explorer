import { describe, expect, it } from "vite-plus/test";
import { scanPages } from "./scanPages.ts";

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

    expect(await scanPages(root)).toEqual([
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

    expect(await scanPages(root)).toEqual(["src/page.tsx"]);
  });
});
