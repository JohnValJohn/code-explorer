export interface PathMatch {
  path: string;
  /** Start of the matched range in `path`, or -1 when the query is empty. */
  start: number;
  end: number;
}

/**
 * Case-insensitive substring match on the full path. An empty (or
 * whitespace-only) query returns every path unhighlighted, with `pinned`
 * moved to the top when it's one of them.
 */
export function filterPaths(
  paths: readonly string[],
  query: string,
  pinned?: string | null,
): PathMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    const ordered =
      pinned != null && paths.includes(pinned)
        ? [pinned, ...paths.filter((path) => path !== pinned)]
        : paths;
    return ordered.map((path) => ({ path, start: -1, end: -1 }));
  }

  const matches: PathMatch[] = [];
  for (const path of paths) {
    const start = path.toLowerCase().indexOf(needle);
    if (start !== -1) {
      matches.push({ path, start, end: start + needle.length });
    }
  }
  return matches;
}
