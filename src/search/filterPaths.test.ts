import { describe, expect, it } from "vite-plus/test";
import { filterPaths } from "./filterPaths.ts";

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
