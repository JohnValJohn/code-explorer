import { describe, expect, it } from "vite-plus/test";
import { matchSubpath } from "./subpaths.ts";

describe("matchSubpath", () => {
  it("substitutes the wildcard of the longest matching pattern", () => {
    const imports = {
      "#src/*": "./src/*",
      "#src/ui/*": "./src/design-system/*",
      "#config": "./config/index.ts",
    };
    expect(matchSubpath(imports, "#src/app/Hero")).toEqual(["./src/app/Hero"]);
    expect(matchSubpath(imports, "#src/ui/Button")).toEqual(["./src/design-system/Button"]);
    expect(matchSubpath(imports, "#config")).toEqual(["./config/index.ts"]);
    expect(matchSubpath(imports, "#other/x")).toEqual([]);
  });

  it("supports patterns with a suffix", () => {
    expect(matchSubpath({ "#icons/*.svg": "./assets/*.svg" }, "#icons/star.svg")).toEqual([
      "./assets/star.svg",
    ]);
  });

  it("lists every conditional target except declarations and packages", () => {
    expect(
      matchSubpath(
        {
          "#src/*": {
            types: "./dist/*.d.ts",
            development: "./src/*.tsx",
            node: ["some-package", "./lib/*.js"],
            default: "./dist/*.js",
          },
        },
        "#src/Card",
      ),
    ).toEqual(["./src/Card.tsx", "./lib/Card.js", "./dist/Card.js"]);
  });

  it("ignores missing or malformed fields", () => {
    expect(matchSubpath(undefined, "#src/a")).toEqual([]);
    expect(matchSubpath("nope", "#src/a")).toEqual([]);
  });
});
