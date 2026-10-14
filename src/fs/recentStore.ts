// Remembers the most recently visited pages, most recent first, so they can be
// listed separately and the last one reopened after a reload.
// The paths are relative to the root folder, so they're cleared when the folder changes.

const RECENT_PATHS_KEY = "code-explorer:recent-paths";
export const MAX_RECENT_PATHS = 10;

export function loadRecentPaths(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_PATHS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((path) => typeof path === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecentPaths(paths: readonly string[]): void {
  try {
    if (paths.length === 0) localStorage.removeItem(RECENT_PATHS_KEY);
    else localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(paths));
  } catch {
    // Remembering visits is a convenience; ignore storage failures.
  }
}

/** Moves (or adds) `path` to the front, keeping at most `MAX_RECENT_PATHS`. */
export function addRecentPath(recent: readonly string[], path: string): string[] {
  return [path, ...recent.filter((p) => p !== path)].slice(0, MAX_RECENT_PATHS);
}
