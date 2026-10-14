import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { tryReadFileAtPath } from "../fs/readFile.ts";
import { createProject, DIALOG_REGISTRIES, type ComponentLocation } from "../resolve/project.ts";
import { findPage } from "../routes/findPage.ts";
import {
  branchPaths,
  canExpand,
  layoutTree,
  loadTarget,
  nodeLabel,
  NODE_HEIGHT,
  pageTree,
  pendingLoads,
  restoreTree,
  ROOT_ID,
  targetKey,
  type Children,
  type LoadTarget,
  type Tree,
  type TreeNode,
} from "./tree.ts";

type ComponentFlowNode = Node<{ node: TreeNode }, "component">;

const nodeTypes = { component: ComponentNode };

interface ComponentGraphProps {
  root: FileSystemDirectoryHandle;
  /** Folders with a package.json, to resolve imports of other packages in the repo. */
  packageDirs: string[];
  /** Every page, to find where `<Navigate>`s lead. */
  pages: string[];
  path: string;
  /** The tree as it was left, when coming back to this page. */
  initialTree?: Tree;
  /** The page this one was reached from through a `<Navigate>`, to go back to. */
  previousPath?: string;
  onBack: () => void;
  onPrevious: () => void;
  /** Opens the page a `<Navigate>` leads to; `tree` is this page's, to restore on return. */
  onFollow: (path: string, tree: Tree) => void;
}

/**
 * A left-to-right tree of the components `path` renders. Clicking a box opens
 * the component's file and adds the components it renders; clicking a
 * `<Navigate>` opens the page it leads to. Remount (via `key`) to show another page.
 */
export function ComponentGraph({
  root,
  packageDirs,
  pages,
  path,
  initialTree,
  previousPath,
  onBack,
  onPrevious,
  onFollow,
}: ComponentGraphProps) {
  // Caches file reads and parses for as long as this page is open.
  const project = useMemo(
    () => createProject((file) => tryReadFileAtPath(root, file), packageDirs),
    [root, packageDirs],
  );
  const [initial] = useState(() => (initialTree ? restoreTree(initialTree) : pageTree(path)));
  const [tree, setTree] = useState<Tree>(initial);

  const load = useCallback(
    async (id: string, { path: file, dialogKey }: LoadTarget) => {
      const setChildren = (children: Children) =>
        setTree((tree) => ({ ...tree, [id]: { ...tree[id], children } }));
      setChildren({ status: "loading" });
      try {
        const { components, syntaxErrors } =
          dialogKey === undefined
            ? await project.listComponents(file)
            : await project.listDialogComponents(file, dialogKey);
        const locations = await Promise.all(
          components.map(async (component): Promise<ComponentLocation> => {
            // `openDialog(DialogKey.card)`: the registry with the `card` dialog,
            // preferring the caller's package, then the page's (its sport).
            if (component.dialogKey === undefined) return project.locate(file, component);
            const registry =
              component.dialogKey === null
                ? null
                : await project.findDialog(component.dialogKey, [file, path]);
            return registry === null ? { kind: "unresolved" } : { kind: "file", path: registry };
          }),
        );
        // `to={generatePath(ROUTES.PLAYER, …)}`: the route constant it's built from.
        const routes = await Promise.all(
          components.map((component) =>
            component.navigateTo === null && component.routeReferences
              ? project.resolveRoute(file, component.routeReferences)
              : Promise.resolve(component.navigateTo),
          ),
        );
        setTree((tree) => {
          const next = { ...tree };
          const openPaths = branchPaths(tree, id);
          const ids = components.map((component, index) => {
            const location = locations[index];
            const childId = `${id}/${index}`;
            next[childId] = {
              id: childId,
              name: component.name,
              source: component.import.source,
              location,
              cycle: false,
              expanded: false,
              children: { status: "idle" },
            };
            if (component.dialogKey !== undefined) {
              next[childId].dialog = { key: component.dialogKey };
            }
            const target = loadTarget(next[childId]);
            next[childId].cycle = target !== null && openPaths.has(targetKey(target));
            const to = routes[index];
            if (to !== undefined) {
              const page = to === null ? null : findPage(to, path, pages, packageDirs);
              next[childId].navigate = { to, page };
            }
            return childId;
          });
          next[id] = { ...next[id], children: { status: "ready", ids, syntaxErrors } };
          return next;
        });
      } catch (error) {
        setChildren({ status: "error", message: String(error) });
      }
    },
    [project, path, pages, packageDirs],
  );

  useEffect(() => {
    for (const { id, ...target } of pendingLoads(initial)) void load(id, target);
  }, [initial, load]);

  const toggle = useCallback(
    (id: string) => {
      const node = tree[id];
      if (node.navigate) {
        if (node.navigate.page !== null) onFollow(node.navigate.page, tree);
        return;
      }
      const target = loadTarget(node);
      if (!canExpand(node) || target === null) return;
      setTree((tree) => ({ ...tree, [id]: { ...tree[id], expanded: !tree[id].expanded } }));
      if (!node.expanded && (node.children.status === "idle" || node.children.status === "error")) {
        void load(id, target);
      }
    },
    [tree, load, onFollow],
  );

  const { nodes, edges } = useMemo(() => {
    const layout = layoutTree(tree);
    return {
      nodes: layout.nodes.map(
        ({ node, x, y, width }): ComponentFlowNode => ({
          id: node.id,
          type: "component",
          position: { x, y },
          width,
          height: NODE_HEIGHT,
          data: { node },
        }),
      ),
      edges: layout.edges.map(
        ({ source, target }): Edge => ({ id: target, source, target, type: "smoothstep" }),
      ),
    };
  }, [tree]);

  const rootChildren = tree[ROOT_ID].children;

  return (
    <section className="graph" aria-label={`Components rendered by ${path}`}>
      <header className="graph-header">
        <button type="button" onClick={onBack}>
          ← Pages
        </button>
        {previousPath && (
          <button type="button" onClick={onPrevious} title={`Back to ${previousPath}`}>
            ← <code>{previousPath}</code>
          </button>
        )}
        <h2>
          <code>{path}</code>
        </h2>
        <Legend />
      </header>

      {rootChildren.status === "error" && <p className="notice error">{rootChildren.message}</p>}
      {rootChildren.status === "ready" && rootChildren.syntaxErrors > 0 && (
        <p className="notice error">
          {rootChildren.syntaxErrors} syntax {rootChildren.syntaxErrors === 1 ? "error" : "errors"}{" "}
          in this file; the graph may be incomplete.
        </p>
      )}
      {(rootChildren.status === "idle" || rootChildren.status === "loading") && (
        <p className="notice">Reading…</p>
      )}
      {rootChildren.status === "ready" && (
        // Mounted once the first level is known so `fitView` frames it.
        <div className="graph-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            // Also what lets nodes receive clicks: React Flow disables pointer events otherwise.
            onNodeClick={(_, { id }) => toggle(id)}
            colorMode="system"
            fitView
            fitViewOptions={{ maxZoom: 1 }}
            minZoom={0.1}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
    </section>
  );
}

function ComponentNode({ data: { node } }: NodeProps<ComponentFlowNode>) {
  const kind =
    node.id === ROOT_ID
      ? "page"
      : node.navigate
        ? node.navigate.page === null
          ? "navigate unresolved"
          : "navigate"
        : node.cycle
          ? "cycle"
          : node.dialog
            ? `dialog ${node.location.kind}`
            : node.location.kind;
  const content = (
    <>
      <span className="graph-node-name">{nodeLabel(node)}</span>
      <span className="graph-node-indicator" aria-hidden>
        {indicator(node)}
      </span>
    </>
  );

  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {node.navigate?.page ? (
        <button type="button" className={`graph-node ${kind}`} title={describe(node)}>
          {content}
        </button>
      ) : canExpand(node) && node.id !== ROOT_ID ? (
        <button
          type="button"
          className={`graph-node ${kind}`}
          aria-expanded={node.expanded}
          title={describe(node)}
          // The click bubbles to `onNodeClick`.
        >
          {content}
        </button>
      ) : (
        <div className={`graph-node ${kind}`} title={describe(node)}>
          {content}
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

function indicator(node: TreeNode): string {
  if (node.id === ROOT_ID) return "";
  if (node.navigate) return node.navigate.page === null ? "?" : "↗";
  if (node.cycle) return "↻";
  if (node.location.kind === "unresolved") return "?";
  if (node.location.kind === "package") return "";
  switch (node.children.status) {
    case "loading":
      return "…";
    case "error":
      return "!";
    case "ready":
      if (node.children.ids.length === 0) return "∅";
      return node.expanded ? "−" : "+";
    default:
      return "+";
  }
}

function describe(node: TreeNode): string {
  if (node.navigate) {
    const { to, page } = node.navigate;
    if (to === null) return "Couldn't find a static route or a routes.ts constant to navigate to";
    if (page === null) return `No page matches ${to}`;
    return `Opens ${page}`;
  }
  if (node.dialog) {
    const { key } = node.dialog;
    const lines =
      key === null
        ? ["Couldn't find a static DialogKey to open"]
        : node.location.kind === "file"
          ? [`Opens the ${key} dialog of ${node.location.path}`]
          : [`No ${key} dialog in ${DIALOG_REGISTRIES.join(", ")}`];
    if (node.cycle) lines.push("Already open higher up this branch");
    if (node.children.status === "error") lines.push(node.children.message);
    return lines.join("\n");
  }
  const lines = [node.source];
  if (node.location.kind === "file" && node.location.path !== node.source) {
    lines.push(node.location.path);
  }
  if (node.cycle) lines.push("Already open higher up this branch");
  if (node.location.kind === "unresolved") lines.push("Couldn't find this file");
  if (node.children.status === "ready" && node.children.syntaxErrors > 0) {
    lines.push(`${node.children.syntaxErrors} syntax errors; children may be incomplete`);
  }
  if (node.children.status === "error") lines.push(node.children.message);
  return lines.join("\n");
}

function Legend() {
  return (
    <ul className="graph-legend" aria-label="Legend">
      <li className="graph-node file">local</li>
      <li className="graph-node package">package</li>
      <li className="graph-node unresolved">not found</li>
      <li className="graph-node cycle">cycle</li>
      <li className="graph-node navigate">navigate</li>
      <li className="graph-node dialog">dialog</li>
    </ul>
  );
}
