import { describe, expect, it } from "vite-plus/test";
import type { ComponentLocation } from "../resolve/project.ts";
import { branchPaths, layoutTree, ROOT_ID, visibleIds, type Tree, type TreeNode } from "./tree.ts";

function node(id: string, location: ComponentLocation, extra: Partial<TreeNode> = {}): TreeNode {
  return {
    id,
    name: id,
    source: id,
    location,
    cycle: false,
    expanded: false,
    children: { status: "idle" },
    ...extra,
  };
}

const ready = (...ids: string[]) => ({ status: "ready" as const, ids, syntaxErrors: 0 });

// page → Card (expanded) → Button; page → Hero (collapsed, with a loaded child).
const tree: Tree = {
  [ROOT_ID]: node(
    ROOT_ID,
    { kind: "file", path: "page.tsx" },
    { expanded: true, children: ready("root/0", "root/1") },
  ),
  "root/0": node(
    "root/0",
    { kind: "file", path: "Card.tsx" },
    { expanded: true, children: ready("root/0/0") },
  ),
  "root/0/0": node("root/0/0", { kind: "package" }),
  "root/1": node("root/1", { kind: "file", path: "Hero.tsx" }, { children: ready("root/1/0") }),
  "root/1/0": node("root/1/0", { kind: "file", path: "Title.tsx" }),
};

describe("tree", () => {
  it("lists only expanded branches", () => {
    expect(visibleIds(tree)).toEqual([ROOT_ID, "root/0", "root/0/0", "root/1"]);
  });

  it("collects the files open along a branch", () => {
    expect(branchPaths(tree, "root/0/0")).toEqual(new Set(["page.tsx", "Card.tsx"]));
  });

  it("lays out children to the right of their parent, in render order", () => {
    const { nodes, edges } = layoutTree(tree);
    const at = Object.fromEntries(nodes.map(({ node, x, y }) => [node.id, { x, y }]));
    expect(at["root/0"].x).toBeGreaterThan(at[ROOT_ID].x);
    expect(at["root/0/0"].x).toBeGreaterThan(at["root/0"].x);
    expect(at["root/1"].x).toBe(at["root/0"].x);
    expect(at["root/1"].y).toBeGreaterThan(at["root/0"].y);
    // The parent sits midway between its first and last child.
    expect(at[ROOT_ID].y).toBe((at["root/0"].y + at["root/1"].y) / 2);
    expect(edges).toEqual([
      { source: ROOT_ID, target: "root/0" },
      { source: "root/0", target: "root/0/0" },
      { source: ROOT_ID, target: "root/1" },
    ]);
  });
});
