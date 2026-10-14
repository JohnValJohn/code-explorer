// Remembers the last clicked result so it can be reselected after a reload.
// The path is relative to the root folder, so it's cleared when the folder changes.

const SELECTED_PATH_KEY = "code-explorer:selected-path";

export function loadSelectedPath(): string | null {
  try {
    return localStorage.getItem(SELECTED_PATH_KEY);
  } catch {
    return null;
  }
}

export function saveSelectedPath(path: string | null): void {
  try {
    if (path === null) localStorage.removeItem(SELECTED_PATH_KEY);
    else localStorage.setItem(SELECTED_PATH_KEY, path);
  } catch {
    // Remembering the selection is a convenience; ignore storage failures.
  }
}
