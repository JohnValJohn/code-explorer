import type { ParseResult } from "oxc-parser";
import {
  isLocalSource,
  listComponents,
  type RenderedComponent,
} from "../components/listComponents.ts";
import { parseSource } from "../parser/parseSource.ts";
import { dirname, joinPath } from "./paths.ts";
import { matchSubpath } from "./subpaths.ts";

/** Reads a root-relative file, or returns null when there's no such file. */
export type ReadFile = (path: string) => Promise<string | null>;

/** Where a rendered component is defined. */
export type ComponentLocation =
  | { kind: "file"; path: string }
  | { kind: "package" }
  // A local import we couldn't map to a file (unknown alias, missing file…).
  | { kind: "unresolved" };

export interface FileComponents {
  components: RenderedComponent[];
  syntaxErrors: number;
}

export interface Project {
  /** Lists the imported components rendered anywhere in the file at `path`. */
  listComponents(path: string): Promise<FileComponents>;
  /** Finds the file defining `component`, rendered in `importer`, following barrel re-exports. */
  locate(importer: string, component: RenderedComponent): Promise<ComponentLocation>;
}

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const HAS_EXTENSION = /\.(tsx?|jsx?|mjs|cjs)$/;

interface PackageJson {
  name?: unknown;
  imports?: unknown;
  exports?: unknown;
  source?: unknown;
  module?: unknown;
  main?: unknown;
}

/**
 * Resolves module specifiers and reads/parses files, caching both per path.
 * `packageDirs` are the repo's folders with a package.json, so that imports of
 * its other packages (`@scope/ui/Button`) resolve into the repo.
 */
export function createProject(read: ReadFile, packageDirs: readonly string[] = []): Project {
  const texts = new Map<string, Promise<string | null>>();
  const parses = new Map<string, Promise<ParseResult | null>>();
  let workspace: Promise<Map<string, string>> | undefined;

  function readCached(path: string): Promise<string | null> {
    let text = texts.get(path);
    if (!text) texts.set(path, (text = read(path)));
    return text;
  }

  function parse(path: string): Promise<ParseResult | null> {
    let result = parses.get(path);
    if (!result) {
      result = readCached(path).then((code) => (code === null ? null : parseSource(path, code)));
      parses.set(path, result);
    }
    return result;
  }

  async function nearestPackageDir(path: string): Promise<string | null> {
    for (let dir = dirname(path); ; dir = dirname(dir)) {
      if ((await readCached(dir === "" ? "package.json" : `${dir}/package.json`)) !== null) {
        return dir;
      }
      if (dir === "") return null;
    }
  }

  async function firstExisting(candidates: string[]): Promise<string | null> {
    for (const candidate of candidates) {
      if ((await readCached(candidate)) !== null) return candidate;
    }
    return null;
  }

  async function packageJson(dir: string): Promise<PackageJson> {
    const text = await readCached(dir === "" ? "package.json" : `${dir}/package.json`);
    try {
      const json: unknown = text === null ? null : JSON.parse(text);
      return json !== null && typeof json === "object" ? json : {};
    } catch {
      return {};
    }
  }

  /** Maps the names of the repo's packages to their folders. */
  function workspacePackages(): Promise<Map<string, string>> {
    return (workspace ??= Promise.all(
      packageDirs.map(async (dir) => [(await packageJson(dir)).name, dir] as const),
    ).then(
      (entries) =>
        new Map(entries.filter((entry): entry is [string, string] => typeof entry[0] === "string")),
    ));
  }

  /** Splits `@scope/ui/Button` into the repo package it imports from and the rest. */
  async function findWorkspacePackage(
    specifier: string,
  ): Promise<{ dir: string; rest: string } | null> {
    let best: { name: string; dir: string } | null = null;
    for (const [name, dir] of await workspacePackages()) {
      if (
        (specifier === name || specifier.startsWith(`${name}/`)) &&
        (best === null || name.length > best.name.length)
      ) {
        best = { name, dir };
      }
    }
    return best && { dir: best.dir, rest: specifier.slice(best.name.length + 1) };
  }

  /** Candidate targets, relative to the package folder, for `rest` of a repo package. */
  function packageTargets(json: PackageJson, rest: string): string[] {
    const { exports } = json;
    // `exports` is either a map of subpaths (`"./*"`) or directly the target of `"."`.
    const subpaths =
      exports !== null &&
      typeof exports === "object" &&
      !Array.isArray(exports) &&
      Object.keys(exports).some((key) => key.startsWith("."))
        ? exports
        : { ".": exports };
    const targets = matchSubpath(subpaths, rest === "" ? "." : `./${rest}`);
    if (rest === "") {
      for (const field of [json.source, json.module, json.main]) {
        if (typeof field === "string") targets.push(field.startsWith("./") ? field : `./${field}`);
      }
    }
    // Packages without (matching) exports, imported straight from their files.
    targets.push(`./${rest}`, `./src/${rest}`);
    return targets;
  }

  /** Maps a local specifier to a file, or null when it can't be found. */
  async function resolveFile(importer: string, specifier: string): Promise<string | null> {
    let bases: (string | null)[];
    if (specifier.startsWith("#")) {
      // Node subpath imports, declared in the importer's package.json.
      const packageDir = await nearestPackageDir(importer);
      if (packageDir === null) return null;
      bases = matchSubpath((await packageJson(packageDir)).imports, specifier).map((target) =>
        joinPath(packageDir, target),
      );
    } else if (specifier.startsWith("@/")) {
      const packageDir = await nearestPackageDir(importer);
      if (packageDir === null) return null;
      bases = [joinPath(packageDir, `src/${specifier.slice(2)}`)];
    } else if (specifier === "." || specifier === ".." || /^\.{1,2}\//.test(specifier)) {
      bases = [joinPath(dirname(importer), specifier)];
    } else {
      const found = await findWorkspacePackage(specifier);
      if (found === null) return null;
      bases = packageTargets(await packageJson(found.dir), found.rest).map((target) =>
        joinPath(found.dir, target),
      );
    }

    for (const base of bases) {
      if (base === null) continue;
      const found = await firstExisting([
        ...(HAS_EXTENSION.test(base) ? [base] : []),
        // TS ESM style: `./Button.js` refers to `./Button.tsx`.
        ...(/\.jsx?$/.test(base) ? EXTENSIONS.map((ext) => base.replace(/\.jsx?$/, ext)) : []),
        ...EXTENSIONS.map((ext) => base + ext),
        ...EXTENSIONS.map((ext) => `${base}/index${ext}`),
      ]);
      if (found !== null) return found;
    }
    return null;
  }

  /**
   * Follows re-exports from `path` to the file that defines export `name`.
   * Returns null when `path` doesn't export `name`.
   */
  async function findDefinition(
    path: string,
    name: string,
    visited: Set<string>,
  ): Promise<string | null> {
    const key = `${path}#${name}`;
    if (visited.has(key)) return null;
    visited.add(key);

    const parsed = await parse(path);
    if (parsed === null) return null;

    const starSources: string[] = [];
    for (const statement of parsed.module.staticExports) {
      for (const entry of statement.entries) {
        const { exportName, importName, moduleRequest } = entry;
        if (importName.kind === "AllButDefault") {
          if (moduleRequest && name !== "default") starSources.push(moduleRequest.value);
          continue;
        }
        const matches =
          name === "default" ? exportName.kind === "Default" : exportName.name === name;
        if (!matches) continue;
        if (!moduleRequest) return path;

        const target = await resolveFile(path, moduleRequest.value);
        if (target === null) return null;
        // `export * as UI from "./ui"`: the namespace itself, best shown as its module.
        if (importName.kind === "All") return target;
        return (await findDefinition(target, importName.name!, visited)) ?? target;
      }
    }

    for (const source of starSources) {
      const target = await resolveFile(path, source);
      if (target === null) continue;
      const found = await findDefinition(target, name, visited);
      if (found !== null) return found;
    }
    return null;
  }

  return {
    async listComponents(path) {
      const parsed = await parse(path);
      const code = await readCached(path);
      if (parsed === null || code === null) throw new Error(`Can't read ${path}`);
      return {
        components: listComponents(parsed.program, parsed.module, code),
        syntaxErrors: parsed.errors.filter((error) => error.severity === "Error").length,
      };
    },

    async locate(importer, component) {
      const { source, importedName } = component.import;
      const module = await resolveFile(importer, source);
      if (module === null) {
        const inRepo = isLocalSource(source) || (await findWorkspacePackage(source)) !== null;
        return { kind: inRepo ? "unresolved" : "package" };
      }

      // `<UI.Card>` with `import * as UI`: look up the `Card` export.
      const name = importedName === "*" ? component.name.split(".")[1] : importedName;
      if (name === undefined) return { kind: "file", path: module };
      // Fall back to the module itself if the export can't be traced (CommonJS, dynamic exports…).
      const definition = (await findDefinition(module, name, new Set())) ?? module;
      return { kind: "file", path: definition };
    },
  };
}
