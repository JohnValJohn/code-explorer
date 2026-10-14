export const PAGE_FILE_NAME = "page.tsx";

const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "out", "coverage"]);

export function isIgnoredDirectory(name: string): boolean {
  // Dot-folders cover .git, .next, .turbo, .cache, etc.
  return name.startsWith(".") || IGNORED_DIRECTORIES.has(name);
}

export interface Repository {
  /** Root-relative paths of every `page.tsx` file, sorted alphabetically. */
  pages: string[];
  /** Root-relative folders containing a package.json ("" for the root), sorted. */
  packageDirs: string[];
}

/**
 * Recursively walks `root` for `page.tsx` files and package folders. Sibling
 * directories are read in parallel since each read is an async round-trip to
 * the browser.
 */
export async function scanRepository(root: FileSystemDirectoryHandle): Promise<Repository> {
  const pages: string[] = [];
  const packageDirs: string[] = [];

  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    const subdirectories: Promise<void>[] = [];
    for await (const entry of dir.values()) {
      if (entry.kind === "directory") {
        if (!isIgnoredDirectory(entry.name)) {
          subdirectories.push(walk(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`));
        }
      } else if (entry.name === PAGE_FILE_NAME) {
        pages.push(`${prefix}${entry.name}`);
      } else if (entry.name === "package.json") {
        packageDirs.push(prefix.slice(0, -1));
      }
    }
    await Promise.all(subdirectories);
  }

  await walk(root, "");
  const byName = (a: string, b: string) => a.localeCompare(b);
  return { pages: pages.sort(byName), packageDirs: packageDirs.sort(byName) };
}
