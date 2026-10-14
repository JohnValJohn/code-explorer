// Helpers for root-relative POSIX paths like `src/app/page.tsx` ("" is the root).

export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Joins `relative` onto `dir`, resolving `.` and `..`. Returns null when it escapes the root. */
export function joinPath(dir: string, relative: string): string | null {
  const segments = dir === "" ? [] : dir.split("/");
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}
