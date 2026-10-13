export const PAGE_FILE_NAME = "page.tsx";

const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "out", "coverage"]);

export function isIgnoredDirectory(name: string): boolean {
  // Dot-folders cover .git, .next, .turbo, .cache, etc.
  return name.startsWith(".") || IGNORED_DIRECTORIES.has(name);
}

/**
 * Recursively walks `root` and returns the root-relative paths of every
 * `page.tsx` file, sorted alphabetically. Sibling directories are read in
 * parallel since each read is an async round-trip to the browser.
 */
export async function scanPages(root: FileSystemDirectoryHandle): Promise<string[]> {
  const paths: string[] = [];

  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    const subdirectories: Promise<void>[] = [];
    for await (const entry of dir.values()) {
      if (entry.kind === "directory") {
        if (!isIgnoredDirectory(entry.name)) {
          subdirectories.push(walk(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`));
        }
      } else if (entry.name === PAGE_FILE_NAME) {
        paths.push(`${prefix}${entry.name}`);
      }
    }
    await Promise.all(subdirectories);
  }

  await walk(root, "");
  return paths.sort((a, b) => a.localeCompare(b));
}
