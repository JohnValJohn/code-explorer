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

/**
 * Splits `matches` into the recently visited ones, in `recent` order, and the
 * remaining ones, in their original order.
 */
export function splitRecent(
  matches: readonly PathMatch[],
  recent: readonly string[],
): { recent: PathMatch[]; others: PathMatch[] } {
  const byPath = new Map(matches.map((match) => [match.path, match]));
  const recentMatches = recent.flatMap((path) => byPath.get(path) ?? []);
  const recentSet = new Set(recent);
  return {
    recent: recentMatches,
    others: matches.filter((match) => !recentSet.has(match.path)),
  };
}
