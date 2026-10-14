/**
 * Matches `specifier` against a package.json `imports` field (`#src/ui/Button`)
 * or `exports` field (`./ui/Button`) and returns the candidate targets,
 * relative to the package folder (e.g. `./src/ui/Button`), most likely first.
 *
 * Follows Node's subpath patterns: exact keys win, otherwise the `*` pattern
 * with the longest prefix. Every conditional target is returned (not just the
 * one a given runtime would pick) so the caller can use whichever points at a
 * source file. Type declarations are skipped since they don't contain JSX.
 */
export function matchSubpath(map: unknown, specifier: string): string[] {
  if (map === null || typeof map !== "object") return [];
  const entries = map as Record<string, unknown>;

  if (Object.hasOwn(entries, specifier) && !specifier.includes("*")) {
    return targetsOf(entries[specifier]);
  }

  let best: { key: string; prefix: string } | null = null;
  for (const key of Object.keys(entries)) {
    const star = key.indexOf("*");
    if (star === -1 || star !== key.lastIndexOf("*")) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (
      specifier.length >= key.length - 1 &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      (best === null || prefix.length > best.prefix.length)
    ) {
      best = { key, prefix };
    }
  }
  if (best === null) return [];

  const suffix = best.key.slice(best.prefix.length + 1);
  const match = specifier.slice(best.prefix.length, specifier.length - suffix.length);
  return targetsOf(entries[best.key]).map((target) => target.replaceAll("*", match));
}

/** Flattens a target (string, conditions object or fallback array) into its strings, in order. */
function targetsOf(target: unknown): string[] {
  if (typeof target === "string") {
    // Only package-relative targets point into this package; skip declaration files.
    return target.startsWith("./") && !/\.d\.[cm]?ts$/.test(target) ? [target] : [];
  }
  if (Array.isArray(target)) return target.flatMap(targetsOf);
  if (target !== null && typeof target === "object") {
    return Object.values(target).flatMap(targetsOf);
  }
  return [];
}
