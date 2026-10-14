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
  /**
   * As written in JSX: `Button`, `UI.Card`, `motion.div`; or the function
   * from `useNavigate()` that is called, e.g. `navigate()`.
   */
  name: string;
  /** The import of the component's root binding (`UI` for `UI.Card`), or of `useNavigate`. */
  import: ComponentImport;
  /** How many times the component is rendered. */
  count: number;
  /** 1-based line of the first render. */
  line: number;
  /**
   * For `<Navigate to="…">` and `navigate(…)` calls from `useNavigate()`
   * (react-router's API): the route it leads to, with template literal holes
   * as `:params`, or null when it isn't static. Each distinct route is listed
   * separately.
   */
  navigateTo?: string | null;
  /** When `navigateTo` is null: the imported values `to` is computed from, in source order. */
  routeReferences?: RouteReference[];
}

/** An imported value used in an expression, e.g. `ROUTES.player.show` → `ROUTES` + `["player", "show"]`. */
export interface RouteReference {
  import: ComponentImport;
  /** The properties read from the import, as written. */
  path: string[];
}

export const NAVIGATE_COMPONENT = "Navigate";
export const NAVIGATE_HOOK = "useNavigate";

type AstNode = { type: string; [key: string]: unknown };

/** A static route from a `to` expression: `"/a"`, `` `/a/${id}` `` (→ `/a/:id`), `{ pathname: "/a" }`. */
function staticRoute(expression: AstNode | null | undefined): string | null {
  if (!expression) return null;
  switch (expression.type) {
    case "Literal":
      return typeof expression.value === "string" ? expression.value : null;
    case "TemplateLiteral": {
      const quasis = expression.quasis as { value: { cooked: string | null } }[];
      const expressions = expression.expressions as AstNode[];
      let route = quasis[0].value.cooked ?? "";
      expressions.forEach((hole, index) => {
        const name = hole.type === "Identifier" ? (hole.name as string) : "param";
        route += `:${name}${quasis[index + 1].value.cooked ?? ""}`;
      });
      return route;
    }
    case "ObjectExpression":
      for (const property of expression.properties as AstNode[]) {
        const key = property.key as AstNode | undefined;
        if (
          property.type === "Property" &&
          ((key?.type === "Identifier" && key.name === "pathname") ||
            (key?.type === "Literal" && key.value === "pathname"))
        ) {
          return staticRoute(property.value as AstNode);
        }
      }
      return null;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return staticRoute(expression.expression as AstNode);
    default:
      return null;
  }
}

/** The expression passed as `to`, or null without one. */
function toExpression(attributes: AstNode[]): AstNode | null {
  for (const attribute of attributes) {
    if (attribute.type !== "JSXAttribute") continue;
    if ((attribute.name as AstNode).name !== "to") continue;
    const value = attribute.value as AstNode | null;
    return value?.type === "JSXExpressionContainer" ? (value.expression as AstNode) : value;
  }
  return null;
}

/**
 * Lists the imported values `expression` reads, following identifiers declared
 * in the file (`const url = generatePath(PLAYER, …)`) to their initializer.
 */
function routeReferences(
  expression: AstNode,
  imports: Map<string, ComponentImport>,
  declarations: () => Map<string, AstNode | null>,
): RouteReference[] {
  const references: RouteReference[] = [];
  const followed = new Set<string>();

  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const ast = node as AstNode;

    // `a.b.c` with only static properties: a reference to `a` with path `b.c`.
    const path: string[] = [];
    let root: AstNode = ast;
    while (root.type === "MemberExpression" && !root.computed) {
      path.unshift((root.property as AstNode).name as string);
      root = root.object as AstNode;
    }
    if (root.type === "Identifier") {
      const name = root.name as string;
      const imported = imports.get(name);
      if (imported) references.push({ import: imported, path });
      else if (!followed.has(name)) {
        followed.add(name);
        const init = declarations().get(name);
        if (init) visit(init);
      }
      return;
    }

    for (const [key, child] of Object.entries(ast)) {
      // Object keys and non-computed properties aren't references.
      if (key === "key" && ast.type === "Property" && !ast.computed) continue;
      if (key === "property" && ast.type === "MemberExpression" && !ast.computed) continue;
      visit(child);
    }
  }

  visit(expression);
  return references;
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
function walk(node: unknown, visit: (node: AstNode & { start: number }) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
  } else if (node !== null && typeof node === "object") {
    if (typeof (node as { type?: unknown }).type === "string") {
      visit(node as AstNode & { start: number });
    }
    for (const child of Object.values(node)) walk(child, visit);
  }
}

/**
 * Lists the imported components a file renders in JSX, in order of first
 * render, each with the import it comes from. Components defined in the file
 * itself are left out. Calls to the function returned by `useNavigate()` are
 * listed alongside, as they lead to other pages too.
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

  // Variables declared with a single initializer anywhere in the file, by name;
  // null when the name is declared more than once.
  let declarations: Map<string, AstNode | null> | undefined;
  const getDeclarations = () => {
    if (declarations) return declarations;
    declarations = new Map();
    walk(program, (node) => {
      if (node.type !== "VariableDeclarator") return;
      const id = node.id as AstNode;
      if (id.type !== "Identifier") return;
      const name = id.name as string;
      declarations!.set(name, declarations!.has(name) ? null : ((node.init as AstNode) ?? null));
    });
    return declarations;
  };

  const isNavigate = (name: string) =>
    name === NAVIGATE_COMPONENT || imports.get(name)?.importedName === NAVIGATE_COMPONENT;

  // `const navigate = useNavigate()`: the variables holding a navigate function,
  // with the hook's import.
  const navigateFunctions = new Map<string, ComponentImport>();
  const isNavigateHook = (name: string) =>
    imports.has(name) &&
    (name === NAVIGATE_HOOK || imports.get(name)!.importedName === NAVIGATE_HOOK);
  walk(program, (node) => {
    if (node.type !== "VariableDeclarator" || (node.id as AstNode).type !== "Identifier") return;
    const init = node.init as AstNode | null;
    const callee = init?.type === "CallExpression" ? (init.callee as AstNode) : null;
    if (callee?.type === "Identifier" && isNavigateHook(callee.name as string)) {
      navigateFunctions.set(
        (node.id as AstNode).name as string,
        imports.get(callee.name as string)!,
      );
    }
  });

  // Keyed by name, plus the target for navigations.
  const found = new Map<
    string,
    {
      name: string;
      import: ComponentImport;
      navigateTo?: string | null;
      routeReferences?: RouteReference[];
      start: number;
      count: number;
    }
  >();
  /** `route` is the expression navigated to, or undefined for a plain component. */
  function record(
    name: string,
    imported: ComponentImport,
    start: number,
    route?: AstNode | null,
  ): void {
    let to: string | null | undefined;
    let references: RouteReference[] | undefined;
    if (route !== undefined) {
      to = staticRoute(route);
      if (to === null && route !== null) {
        references = routeReferences(route, imports, getDeclarations);
      }
    }
    const target =
      to ??
      (references ?? [])
        .map((ref) => [ref.import.source, ref.import.importedName, ...ref.path].join("."))
        .join(",");
    const key = to === undefined ? name : `${name}\0${target}`;
    const seen = found.get(key);
    if (seen) {
      seen.count++;
      seen.start = Math.min(seen.start, start);
    } else {
      found.set(key, {
        name,
        import: imported,
        ...(to !== undefined && { navigateTo: to }),
        ...(references && { routeReferences: references }),
        start,
        count: 1,
      });
    }
  }

  walk(program, (node) => {
    if (node.type === "JSXOpeningElement") {
      const name = componentName((node as unknown as { name: JSXElementName }).name);
      const imported = name === null ? undefined : imports.get(name.split(".")[0]);
      if (name === null || !imported) return;
      const route = isNavigate(name) ? toExpression(node.attributes as AstNode[]) : undefined;
      record(name, imported, node.start, route);
    } else if (node.type === "CallExpression") {
      // `navigate(ROUTE)`; `navigate(-1)` goes back in history, which isn't a page.
      const callee = node.callee as AstNode;
      if (callee.type !== "Identifier" || !navigateFunctions.has(callee.name as string)) return;
      const [route] = node.arguments as AstNode[];
      if (!route || route.type === "UnaryExpression" || typeof route.value === "number") return;
      const name = callee.name as string;
      record(`${name}()`, navigateFunctions.get(name)!, node.start, route);
    }
  });

  const sorted = [...found.values()].sort((a, b) => a.start - b.start);

  // Compute line numbers in one pass over the (sorted) first-render positions.
  let line = 1;
  let cursor = 0;
  return sorted.map(({ start, ...component }) => {
    for (; cursor < start; cursor++) if (code[cursor] === "\n") line++;
    return { ...component, line };
  });
}

/** Relative paths and common path aliases (`@/`, `~/`, `#`) point into the repo. */
export function isLocalSource(source: string): boolean {
  return /^(\.{1,2}\/|\/|@\/|~\/|#)/.test(source) || source === "." || source === "..";
}
