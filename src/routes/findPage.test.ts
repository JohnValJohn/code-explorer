import { describe, expect, it } from "vite-plus/test";
import { findPage } from "./findPage.ts";

const pages = [
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/settings/page.tsx",
  "apps/web/src/app/account/settings/page.tsx",
  "apps/web/src/app/players/new/page.tsx",
  "apps/web/src/app/players/[slug]/page.tsx",
  "apps/web/src/app/(marketing)/about/page.tsx",
  "apps/admin/src/app/page.tsx",
  "apps/admin/src/app/settings/page.tsx",
];
const packageDirs = ["", "apps/admin", "apps/web"];
const from = "apps/web/src/app/account/settings/page.tsx";

const find = (to: string, page = from) => findPage(to, page, pages, packageDirs);

describe("findPage", () => {
  it("prefers the least nested page of the same package", () => {
    expect(find("/settings")).toBe("apps/web/src/app/settings/page.tsx");
    expect(find("/settings", "apps/admin/src/app/page.tsx")).toBe(
      "apps/admin/src/app/settings/page.tsx",
    );
    expect(find("/")).toBe("apps/web/src/app/page.tsx");
  });

  it("matches dynamic folders, preferring literal ones", () => {
    expect(find("/players/new")).toBe("apps/web/src/app/players/new/page.tsx");
    expect(find("/players/neymar")).toBe("apps/web/src/app/players/[slug]/page.tsx");
    expect(find("/players/:slug")).toBe("apps/web/src/app/players/[slug]/page.tsx");
  });

  it("skips route groups and ignores the query and hash", () => {
    expect(find("/about?ref=home#team")).toBe("apps/web/src/app/(marketing)/about/page.tsx");
  });

  it("resolves relative routes against the page's folder", () => {
    expect(find("../../players/new")).toBe("apps/web/src/app/players/new/page.tsx");
    expect(find("..")).toBe(null);
    expect(find("../..")).toBe("apps/web/src/app/page.tsx");
  });

  it("returns null when nothing matches", () => {
    expect(find("/nowhere")).toBe(null);
  });
});
