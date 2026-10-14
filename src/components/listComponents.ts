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
   * from `useNavigate()` or `useOpenDialog()` that is called, e.g. `navigate()`.
   */
  name: string;
  /**
   * The import of the component's root binding (`UI` for `UI.Card`), of the
   * `lazy(() => import(…))` call it's declared with, or of the hook.
   */
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
  /**
   * For `openDialog(DialogKey.card, …)` calls from `useOpenDialog()`: the key
   * of the dialog opened (`card`), or null when it isn't static. Each distinct
   * key is listed separately.
   */
  dialogKey?: string | null;
}

/** An imported value used in an expression, e.g. `ROUTES.player.show` → `ROUTES` + `["player", "show"]`. */
export interface RouteReference {
  import: ComponentImport;
  /** The properties read from the import, as written. */
  path: string[];
}

export const NAVIGATE_COMPONENT = "Navigate";
export const NAVIGATE_HOOK = "useNavigate";
export const OPEN_DIALOG_HOOK = "useOpenDialog";

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

/** `DialogKey.card` or `"card"` → `card`. */
function staticDialogKey(expression: AstNode): string | null {
  if (expression.type === "MemberExpression" && !expression.computed) {
    return (expression.property as AstNode).name as string;
  }
  if (expression.type === "Literal" && typeof expression.value === "string") {
    return expression.value;
  }
  return null;
}

/**
 * The import a `lazy(() => import("./Dialog"), "Dialog")` call loads: React's
 * `lazy` (the default export) or a helper taking the export name second.
 */
function lazyImport(init: AstNode | null): ComponentImport | null {
  if (init?.type !== "CallExpression") return null;
  const callee = init.callee as AstNode;
  const calleeName =
    callee.type === "Identifier"
      ? callee.name
      : callee.type === "MemberExpression" && !callee.computed
        ? (callee.property as AstNode).name
        : null;
  if (calleeName !== "lazy") return null;
  const [factory, exportName] = init.arguments as AstNode[];
  let source: string | null = null;
  walk(factory, (node) => {
    const specifier = node.source as AstNode | undefined;
    if (
      source === null &&
      node.type === "ImportExpression" &&
      specifier?.type === "Literal" &&
      typeof specifier.value === "string"
    ) {
      source = specifier.value;
    }
  });
  if (source === null) return null;
  return {
    source,
    importedName:
      exportName?.type === "Literal" && typeof exportName.value === "string"
        ? exportName.value
        : "default",
  };
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
 * itself are left out, but `lazy(() => import(…))` ones are listed as imports.
 * Calls to the functions returned by `useNavigate()` and `useOpenDialog()` are
 * listed alongside, as they lead to other pages and dialogs too.
 * `program` and `module` come from an oxc-parser result for `code`.
 * With `within`, only renders in that node count, plus those of the
 * components defined in the file that it renders.
 */
export function listComponents(
  program: Program,
  module: EcmaScriptModule,
  code: string,
  within?: unknown,
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

  // `const navigate = useNavigate()`, `const openDialog = useOpenDialog()`: the
  // variables holding a navigate or open dialog function, with the hook's import.
  const navigateFunctions = new Map<string, ComponentImport>();
  const openDialogFunctions = new Map<string, ComponentImport>();
  const isHook = (name: string, hook: string) =>
    imports.has(name) && (name === hook || imports.get(name)!.importedName === hook);
  // `const Dialog = lazy(() => import("./Dialog"), "Dialog")`, rendered like an import.
  const lazyComponents = new Map<string, ComponentImport>();
  walk(program, (node) => {
    if (node.type !== "VariableDeclarator" || (node.id as AstNode).type !== "Identifier") return;
    const name = (node.id as AstNode).name as string;
    const init = node.init as AstNode | null;
    const callee = init?.type === "CallExpression" ? (init.callee as AstNode) : null;
    if (callee?.type === "Identifier") {
      const hook = callee.name as string;
      if (isHook(hook, NAVIGATE_HOOK)) navigateFunctions.set(name, imports.get(hook)!);
      if (isHook(hook, OPEN_DIALOG_HOOK)) openDialogFunctions.set(name, imports.get(hook)!);
    }
    const lazy = lazyImport(init);
    if (lazy && !imports.has(name)) lazyComponents.set(name, lazy);
  });
  for (const [name, lazy] of lazyComponents) imports.set(name, lazy);

  // Keyed by name, plus the target for navigations.
  const found = new Map<
    string,
    {
      name: string;
      import: ComponentImport;
      navigateTo?: string | null;
      routeReferences?: RouteReference[];
      dialogKey?: string | null;
      start: number;
      count: number;
    }
  >();
  function recordDialog(
    name: string,
    imported: ComponentImport,
    start: number,
    key: string | null,
  ) {
    const id = `${name}\0dialog:${key ?? ""}`;
    const seen = found.get(id);
    if (seen) {
      seen.count++;
      seen.start = Math.min(seen.start, start);
    } else {
      found.set(id, {
        name,
        import: imported,
        dialogKey: key,
        start,
        count: 1,
      });
    }
  }
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

  // Components defined in the file whose renders were added, with `within`.
  const followed = new Set<string>();
  // `at` is where the render counts as made: for renders inside a component
  // defined in the file, where that component is rendered within `within`.
  function visit(node: AstNode & { start: number }, at = node.start): void {
    if (node.type === "JSXOpeningElement") {
      const name = componentName((node as unknown as { name: JSXElementName }).name);
      if (name === null) return;
      const imported = imports.get(name.split(".")[0]);
      if (!imported) {
        if (within !== undefined && !name.includes(".") && !followed.has(name)) {
          followed.add(name);
          const definition = getDeclarations().get(name) ?? functionDeclaration(program, name);
          if (definition) walk(definition, (inner) => visit(inner, at));
        }
        return;
      }
      const route = isNavigate(name) ? toExpression(node.attributes as AstNode[]) : undefined;
      record(name, imported, at, route);
    } else if (node.type === "CallExpression") {
      const callee = node.callee as AstNode;
      if (callee.type !== "Identifier") return;
      const name = callee.name as string;
      const [argument] = node.arguments as AstNode[];
      if (!argument) return;
      if (navigateFunctions.has(name)) {
        // `navigate(ROUTE)`; `navigate(-1)` goes back in history, which isn't a page.
        if (argument.type === "UnaryExpression" || typeof argument.value === "number") return;
        record(`${name}()`, navigateFunctions.get(name)!, at, argument);
      } else if (openDialogFunctions.has(name)) {
        recordDialog(`${name}()`, openDialogFunctions.get(name)!, at, staticDialogKey(argument));
      }
    }
  }
  walk(within ?? program, (node) => visit(node));

  const sorted = [...found.values()].sort((a, b) => a.start - b.start);

  // Compute line numbers in one pass over the (sorted) first-render positions.
  let line = 1;
  let cursor = 0;
  return sorted.map(({ start, ...component }) => {
    for (; cursor < start; cursor++) if (code[cursor] === "\n") line++;
    return { ...component, line };
  });
}

/** The `function name() {…}` declared anywhere in `program`. */
function functionDeclaration(program: Program, name: string): AstNode | null {
  let found: AstNode | null = null;
  walk(program, (node) => {
    if (
      found === null &&
      node.type === "FunctionDeclaration" &&
      (node.id as AstNode | null)?.name === name
    ) {
      found = node;
    }
  });
  return found;
}

/** Relative paths and common path aliases (`@/`, `~/`, `#`) point into the repo. */
export function isLocalSource(source: string): boolean {
  return /^(\.{1,2}\/|\/|@\/|~\/|#)/.test(source) || source === "." || source === "..";
}
