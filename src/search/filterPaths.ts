export interface PathMatch {
  path: string;
  /** Start of the matched range in `path`, or -1 when the query is empty. */
  start: number;
  end: number;
}

/**
 * Case-insensitive substring match on the full path. An empty (or
 * whitespace-only) query returns every path unhighlighted.
 */
export function filterPaths(paths: readonly string[], query: string): PathMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return paths.map((path) => ({ path, start: -1, end: -1 }));
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
