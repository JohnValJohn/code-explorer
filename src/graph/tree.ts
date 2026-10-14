import type { ComponentLocation } from "../resolve/project.ts";

export type Children =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; ids: string[]; syntaxErrors: number }
  | { status: "error"; message: string };

/** One box: a rendered component (or the page at the root). Shared components appear once per use. */
export interface TreeNode {
  id: string;
  name: string;
  /** The import specifier, or the page path for the root. */
  source: string;
  location: ComponentLocation;
  /** Its file is already open higher up this branch, so expanding would loop forever. */
  cycle: boolean;
  expanded: boolean;
  children: Children;
  /**
   * For `<Navigate>`: its `to` (null when not static) and the page it leads
   * to, whose graph opens instead of expanding.
   */
  navigate?: { to: string | null; page: string | null };
  /**
   * For `openDialog(DialogKey.key)`: the key (null when not static). When the
   * dialog is found, `location` is the registry it's in and expanding lists
   * the components it renders.
   */
  dialog?: { key: string | null };
}

export type Tree = Record<string, TreeNode>;

export const ROOT_ID = "root";

/** A page's tree before anything is loaded: the page itself, to be expanded. */
export function pageTree(path: string): Tree {
  return {
    [ROOT_ID]: {
      id: ROOT_ID,
      name: path,
      source: path,
      location: { kind: "file", path },
      cycle: false,
      expanded: true,
      children: { status: "idle" },
    },
  };
}

/**
 * A tree saved while some children were still loading, ready to be shown
 * again: those loads were dropped, so they're marked to be redone.
 */
export function restoreTree(tree: Tree): Tree {
  return Object.fromEntries(
    Object.entries(tree).map(([id, node]) => [
      id,
      node.children.status === "loading" ? { ...node, children: { status: "idle" } } : node,
    ]),
  );
}

/** What to read for a node's children: a file, or a dialog of a registry file. */
export interface LoadTarget {
  path: string;
  dialogKey?: string;
}

export function loadTarget(node: TreeNode): LoadTarget | null {
  if (node.location.kind !== "file") return null;
  const key = node.dialog?.key;
  return key ? { path: node.location.path, dialogKey: key } : { path: node.location.path };
}

/** Identifies a load target, to spot cycles. */
export function targetKey({ path, dialogKey }: LoadTarget): string {
  return dialogKey === undefined ? path : `${path}#${dialogKey}`;
}

/** The expanded nodes whose children still have to be loaded. */
export function pendingLoads(tree: Tree): ({ id: string } & LoadTarget)[] {
  return visibleIds(tree).flatMap((id) => {
    const { expanded, children } = tree[id];
    const target = loadTarget(tree[id]);
    return expanded && children.status === "idle" && target ? [{ id, ...target }] : [];
  });
}

export function canExpand(node: TreeNode): boolean {
  return node.location.kind === "file" && !node.cycle && !node.navigate;
}

/** The ids of `id`'s visible descendants and itself, parents before children. */
export function visibleIds(tree: Tree, id = ROOT_ID): string[] {
  const node = tree[id];
  if (!node) return [];
  const ids = [id];
  if (node.expanded && node.children.status === "ready") {
    for (const childId of node.children.ids) ids.push(...visibleIds(tree, childId));
  }
  return ids;
}

/** The `targetKey`s of the files and dialogs open from the root down to `id`, inclusive. */
export function branchPaths(tree: Tree, id: string): Set<string> {
  const paths = new Set<string>();
  // Child ids extend their parent's: `root/2/0` is under `root/2`.
  const segments = id.split("/");
  for (let i = 1; i <= segments.length; i++) {
    const node = tree[segments.slice(0, i).join("/")];
    const target = node && loadTarget(node);
    if (target) paths.add(targetKey(target));
  }
  return paths;
}

export const NODE_HEIGHT = 36;
const CHAR_WIDTH = 8.4; // 14px monospace
const NODE_PADDING = 44; // text padding plus the expand indicator

/** The text shown in the box. */
export function nodeLabel(node: TreeNode): string {
  if (node.navigate) return `${node.name} → ${node.navigate.to ?? "?"}`;
  if (node.dialog) return `${node.name} → ${node.dialog.key ?? "?"}`;
  return node.name;
}

export function nodeWidth(node: TreeNode): number {
  return Math.ceil(nodeLabel(node).length * CHAR_WIDTH + NODE_PADDING);
}

export interface PositionedNode {
  node: TreeNode;
  x: number;
  y: number;
  width: number;
}

const ROW_GAP = 10;
const COLUMN_GAP = 64;

/**
 * Lays out the visible part of `tree` left to right, one column per depth with
 * children in render order; x/y are top-left corners. Leaves are stacked and
 * each parent is centered on its children.
 */
export function layoutTree(tree: Tree): {
  nodes: PositionedNode[];
  edges: { source: string; target: string }[];
} {
  const ids = visibleIds(tree);
  const depth = (id: string) => id.split("/").length - 1;

  const columnWidths: number[] = [];
  for (const id of ids) {
    const d = depth(id);
    columnWidths[d] = Math.max(columnWidths[d] ?? 0, nodeWidth(tree[id]));
  }
  const columnX = [0];
  for (const width of columnWidths) columnX.push(columnX[columnX.length - 1] + width + COLUMN_GAP);

  const visible = new Set(ids);
  const ys = new Map<string, number>();
  let nextLeafY = 0;
  function place(id: string): number {
    const node = tree[id];
    const children =
      node.children.status === "ready"
        ? node.children.ids.filter((child) => visible.has(child))
        : [];
    let y: number;
    if (children.length === 0) {
      y = nextLeafY;
      nextLeafY += NODE_HEIGHT + ROW_GAP;
    } else {
      const childYs = children.map(place);
      y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }
    ys.set(id, y);
    return y;
  }
  place(ROOT_ID);

  return {
    nodes: ids.map((id) => ({
      node: tree[id],
      x: columnX[depth(id)],
      y: ys.get(id)!,
      width: nodeWidth(tree[id]),
    })),
    edges: ids
      .filter((id) => id !== ROOT_ID)
      .map((id) => ({ source: id.slice(0, id.lastIndexOf("/")), target: id })),
  };
}
