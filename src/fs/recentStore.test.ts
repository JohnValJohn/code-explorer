import { describe, expect, it } from "vite-plus/test";
import { addRecentPath, MAX_RECENT_PATHS } from "./recentStore.ts";

describe("addRecentPath", () => {
  it("puts the path first without duplicating it", () => {
    expect(addRecentPath(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(addRecentPath(["a"], "d")).toEqual(["d", "a"]);
  });

  it(`keeps at most ${MAX_RECENT_PATHS} paths`, () => {
    const recent = Array.from({ length: MAX_RECENT_PATHS }, (_, i) => `p${i}`);
    const next = addRecentPath(recent, "new");
    expect(next).toHaveLength(MAX_RECENT_PATHS);
    expect(next[0]).toBe("new");
    expect(next).not.toContain(`p${MAX_RECENT_PATHS - 1}`);
  });
});
