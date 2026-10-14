import type { EcmaScriptModule, JSXElementName, Program } from "oxc-parser";

/** The import a rendered component comes from, enough to locate its definition. */
export interface ComponentImport {
  /** The module specifier, e.g. `react` or `../components/Button`. */
  source: string;
  /**
   * The export of `source` that is imported: `default`, a named export such
   * as `Button` (even when aliased locally), or `*` for a namespace import.
   */
  importedName: string;
}

export interface RenderedComponent {
  /** As written in JSX: `Button`, `UI.Card`, `motion.div`. */
  name: string;
  /** The import of the component's root binding (`UI` for `UI.Card`). */
  import: ComponentImport;
  /** How many times the component is rendered. */
  count: number;
  /** 1-based line of the first render. */
  line: number;
}

// `<Button>` and `<UI.Card>` are components; `<div>` and `<svg:rect>` are not.
function componentName(name: JSXElementName): string | null {
  switch (name.type) {
    case "JSXIdentifier":
      return /^[A-Z]/.test(name.name) ? name.name : null;
    case "JSXMemberExpression": {
      const object =
        name.object.type === "JSXIdentifier" ? name.object.name : componentName(name.object);
      return object === null ? null : `${object}.${name.property.name}`;
    }
    default:
      return null;
  }
}

/** Calls `visit` on every AST node in `node`'s subtree. */
function walk(node: unknown, visit: (node: { type: string; start: number }) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
  } else if (node !== null && typeof node === "object") {
    if (typeof (node as { type?: unknown }).type === "string") {
      visit(node as { type: string; start: number });
    }
    for (const child of Object.values(node)) walk(child, visit);
  }
}

/**
 * Lists the imported components a file renders in JSX, in order of first
 * render, each with the import it comes from. Components defined in the file
 * itself are left out.
 * `program` and `module` come from an oxc-parser result for `code`.
 */
export function listComponents(
  program: Program,
  module: EcmaScriptModule,
  code: string,
): RenderedComponent[] {
  const imports = new Map<string, ComponentImport>();
  for (const statement of module.staticImports) {
    for (const entry of statement.entries) {
      // Type-only bindings can't be rendered.
      if (entry.isType) continue;
      const { kind, name } = entry.importName;
      imports.set(entry.localName.value, {
        source: statement.moduleRequest.value,
        importedName: kind === "NamespaceObject" ? "*" : kind === "Default" ? "default" : name!,
      });
    }
  }

  const found = new Map<string, { start: number; count: number }>();
  walk(program, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    const name = componentName((node as unknown as { name: JSXElementName }).name);
    if (name === null || !imports.has(name.split(".")[0])) return;
    const seen = found.get(name);
    if (seen) {
      seen.count++;
      seen.start = Math.min(seen.start, node.start);
    } else found.set(name, { start: node.start, count: 1 });
  });

  const sorted = [...found].sort(([, a], [, b]) => a.start - b.start);

  // Compute line numbers in one pass over the (sorted) first-render positions.
  let line = 1;
  let cursor = 0;
  return sorted.map(([name, { start, count }]) => {
    for (; cursor < start; cursor++) if (code[cursor] === "\n") line++;
    return { name, import: imports.get(name.split(".")[0])!, count, line };
  });
}

/** Relative paths and common path aliases (`@/`, `~/`, `#`) point into the repo. */
export function isLocalSource(source: string): boolean {
  return /^(\.{1,2}\/|\/|@\/|~\/|#)/.test(source) || source === "." || source === "..";
}
