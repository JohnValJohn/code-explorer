import { describe, expect, it } from "vite-plus/test";
import { filterPaths, splitRecent } from "./filterPaths.ts";

const paths = [
  "folder1/folder2/folder3/page.tsx",
  "app/settings/page.tsx",
  "app/Folder2x/page.tsx",
];

describe("filterPaths", () => {
  it("returns every path when the query is empty", () => {
    expect(filterPaths(paths, "  ").map((m) => m.path)).toEqual(paths);
  });

  it("matches a substring spanning several path segments", () => {
    expect(filterPaths(paths, "folder2/fold")).toEqual([
      { path: "folder1/folder2/folder3/page.tsx", start: 8, end: 20 },
    ]);
  });

  it("is case-insensitive", () => {
    expect(filterPaths(paths, "FOLDER2").map((m) => m.path)).toEqual([
      "folder1/folder2/folder3/page.tsx",
      "app/Folder2x/page.tsx",
    ]);
  });

  it("returns nothing when no path contains the query", () => {
    expect(filterPaths(paths, "missing")).toEqual([]);
  });
});

describe("splitRecent", () => {
  it("lists recent matches in recency order and the others in their original order", () => {
    const { recent, others } = splitRecent(filterPaths(paths, ""), [
      "app/Folder2x/page.tsx",
      "folder1/folder2/folder3/page.tsx",
    ]);
    expect(recent.map((m) => m.path)).toEqual([
      "app/Folder2x/page.tsx",
      "folder1/folder2/folder3/page.tsx",
    ]);
    expect(others.map((m) => m.path)).toEqual(["app/settings/page.tsx"]);
  });

  it("drops recent paths that don't match", () => {
    const { recent, others } = splitRecent(filterPaths(paths, "settings"), [
      "app/Folder2x/page.tsx",
      "missing/page.tsx",
    ]);
    expect(recent).toEqual([]);
    expect(others.map((m) => m.path)).toEqual(["app/settings/page.tsx"]);
  });
});
