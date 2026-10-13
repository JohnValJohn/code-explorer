import type { EcmaScriptModule, StaticExportEntry, StaticImportEntry } from "oxc-parser";

export type ImportKind = "static" | "side-effect" | "re-export" | "dynamic";

export interface ImportEntry {
  /** The module specifier, e.g. `react` or `../components/Button`. */
  source: string;
  kind: ImportKind;
  /** Every binding is type-only: `import type …` / `export type … from` */
  typeOnly: boolean;
  /** Bindings as written: `React`, `* as path`, `useState`, `type FC`, `a as b`. */
  names: string[];
  /** 1-based line of the `import` / `export` keyword. */
  line: number;
}

function importBinding(entry: StaticImportEntry, typeOnly: boolean): string {
  const local = entry.localName.value;
  const { kind, name } = entry.importName;
  const binding =
    kind === "NamespaceObject"
      ? `* as ${local}`
      : kind === "Default" || name === local
        ? local
        : `${name} as ${local}`;
  // The `type` tag already covers statements where every binding is a type.
  return entry.isType && !typeOnly ? `type ${binding}` : binding;
}

function reExportBinding(entry: StaticExportEntry, typeOnly: boolean): string {
  const imported = entry.importName;
  const exported = entry.exportName.name;
  const binding =
    imported.kind === "AllButDefault"
      ? "*"
      : imported.kind === "All"
        ? `* as ${exported}`
        : imported.name === exported
          ? exported!
          : `${imported.name} as ${exported}`;
  return entry.isType && !typeOnly ? `type ${binding}` : binding;
}

// `import("./a")` and `` import(`./a`) `` are shown unquoted; computed
// specifiers like `` import(`./locales/${lang}`) `` are shown as written.
function dynamicSource(expression: string): string {
  const literal = /^(['"`])(.*)\1$/s.exec(expression);
  if (!literal || (literal[1] === "`" && literal[2].includes("${"))) return expression;
  return literal[2];
}

/**
 * Lists the modules a file imports, in source order: static imports,
 * side-effect imports, `export … from` re-exports and dynamic `import()`.
 * `module` is the `module` field of an oxc-parser result for `code`.
 */
export function listImports(module: EcmaScriptModule, code: string): ImportEntry[] {
  const found: { start: number; entry: Omit<ImportEntry, "line"> }[] = [];

  for (const statement of module.staticImports) {
    const { entries } = statement;
    const typeOnly = entries.length > 0 && entries.every((entry) => entry.isType);
    found.push({
      start: statement.start,
      entry: {
        source: statement.moduleRequest.value,
        kind: entries.length === 0 ? "side-effect" : "static",
        typeOnly,
        names: entries.map((entry) => importBinding(entry, typeOnly)),
      },
    });
  }

  for (const statement of module.staticExports) {
    const entries = statement.entries.filter((entry) => entry.moduleRequest);
    if (entries.length === 0) continue;
    const typeOnly = entries.every((entry) => entry.isType);
    found.push({
      start: statement.start,
      entry: {
        source: entries[0].moduleRequest!.value,
        kind: "re-export",
        typeOnly,
        names: entries.map((entry) => reExportBinding(entry, typeOnly)),
      },
    });
  }

  for (const dynamic of module.dynamicImports) {
    const { start, end } = dynamic.moduleRequest;
    found.push({
      start: dynamic.start,
      entry: {
        source: dynamicSource(code.slice(start, end)),
        kind: "dynamic",
        typeOnly: false,
        names: [],
      },
    });
  }

  found.sort((a, b) => a.start - b.start);

  // Compute line numbers in one pass over the (sorted) match positions.
  let line = 1;
  let cursor = 0;
  return found.map(({ start, entry }) => {
    for (; cursor < start; cursor++) if (code[cursor] === "\n") line++;
    return { ...entry, line };
  });
}

/** Relative paths and common path aliases (`@/`, `~/`, `#`) point into the repo. */
export function isLocalSource(source: string): boolean {
  return /^(\.{1,2}\/|\/|@\/|~\/|#)/.test(source) || source === "." || source === "..";
}
