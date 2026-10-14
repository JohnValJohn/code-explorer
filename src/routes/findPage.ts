import { dirname, joinPath } from "../resolve/paths.ts";

// `[id]`, `:id` and `$id` folders match any single segment.
const DYNAMIC_SEGMENT = /^(\[[^.].*\]|:.+|\$.+)$/;
// `(group)` folders organise pages without adding to the URL.
const GROUP_SEGMENT = /^\(.*\)$/;

/** The folders of a page that make up its URL, e.g. `["players", "[slug]"]`. */
function routeSegments(dir: string): string[] {
  return dir === "" ? [] : dir.split("/").filter((segment) => !GROUP_SEGMENT.test(segment));
}

function urlSegments(url: string): string[] {
  return url
    .replace(/[?#].*$/, "")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
}

/** How well `folder` matches the URL segment `segment`, or -1 when it doesn't. */
function segmentScore(folder: string, segment: string): number {
  if (folder === segment) return 2;
  // A `:param` in `to` stands for any value.
  if (DYNAMIC_SEGMENT.test(folder)) return 1;
  return segment.startsWith(":") ? 0 : -1;
}

const isLiteral = (segment: string) => !segment.startsWith(":");

function longestPrefix(path: string, dirs: readonly string[]): string | null {
  let best: string | null = null;
  for (const dir of dirs) {
    if ((dir === "" || path.startsWith(`${dir}/`)) && (best === null || dir.length > best.length)) {
      best = dir;
    }
  }
  return best;
}

/**
 * Finds the page a `<Navigate to>` rendered under page `from` leads to.
 * Where routes start in the repo isn't known, so an absolute `to` matches the
 * end of page folders, preferring pages of `from`'s package, then the least
 * deeply nested, then literal folders over dynamic ones. A relative `to` is
 * resolved against `from`'s folder. Returns null when no page matches.
 */
export function findPage(
  to: string,
  from: string,
  pages: readonly string[],
  packageDirs: readonly string[] = [],
): string | null {
  let anchor: string | null = null;
  let segments: string[];
  if (to.startsWith("/")) {
    segments = urlSegments(to);
  } else {
    const dir = joinPath(dirname(from), to.replace(/[?#].*$/, ""));
    if (dir === null) return null;
    anchor = dir;
    segments = routeSegments(dir);
  }

  const fromPackage = longestPrefix(from, packageDirs);
  let best: { page: string; rank: number[] } | null = null;
  for (const page of pages) {
    const folders = routeSegments(dirname(page));
    const prefixLength = folders.length - segments.length;
    if (prefixLength < 0 || (anchor !== null && prefixLength !== 0)) continue;

    let score = 0;
    let literals = 0;
    for (let i = 0; i < segments.length && score >= 0; i++) {
      const segmentMatch = segmentScore(folders[prefixLength + i], segments[i]);
      score = segmentMatch < 0 ? -1 : score + segmentMatch;
      if (segmentMatch === 2) literals++;
    }
    // Otherwise `/anything` would match the end of every `…/[id]` folder.
    if (score < 0 || (anchor === null && literals === 0 && segments.some(isLiteral))) continue;

    const samePackage = fromPackage !== null && longestPrefix(page, packageDirs) === fromPackage;
    // Higher is better, compared in order.
    const rank = [samePackage ? 1 : 0, -prefixLength, score];
    if (best === null || isBetter(rank, best.rank)) best = { page, rank };
  }
  return best?.page ?? null;
}

function isBetter(rank: number[], other: number[]): boolean {
  for (let i = 0; i < rank.length; i++) {
    if (rank[i] !== other[i]) return rank[i] > other[i];
  }
  return false;
}
