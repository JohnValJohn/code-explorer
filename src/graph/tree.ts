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
}

export type Tree = Record<string, TreeNode>;

export const ROOT_ID = "root";

export function canExpand(node: TreeNode): boolean {
  return node.location.kind === "file" && !node.cycle;
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

/** The file paths open from the root down to `id`, inclusive. */
export function branchPaths(tree: Tree, id: string): Set<string> {
  const paths = new Set<string>();
  // Child ids extend their parent's: `root/2/0` is under `root/2`.
  const segments = id.split("/");
  for (let i = 1; i <= segments.length; i++) {
    const location = tree[segments.slice(0, i).join("/")]?.location;
    if (location?.kind === "file") paths.add(location.path);
  }
  return paths;
}

export const NODE_HEIGHT = 36;
const CHAR_WIDTH = 8.4; // 14px monospace
const NODE_PADDING = 44; // text padding plus the expand indicator

export function nodeWidth(node: TreeNode): number {
  return Math.ceil(node.name.length * CHAR_WIDTH + NODE_PADDING);
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
