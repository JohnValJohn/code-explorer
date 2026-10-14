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
import { createProject } from "../resolve/project.ts";
import {
  branchPaths,
  canExpand,
  layoutTree,
  NODE_HEIGHT,
  ROOT_ID,
  type Children,
  type Tree,
  type TreeNode,
} from "./tree.ts";

type ComponentFlowNode = Node<{ node: TreeNode }, "component">;

const nodeTypes = { component: ComponentNode };

interface ComponentGraphProps {
  root: FileSystemDirectoryHandle;
  path: string;
  onBack: () => void;
}

/**
 * A left-to-right tree of the components `path` renders. Clicking a box opens
 * the component's file and adds the components it renders. Remount (via `key`)
 * to show another page.
 */
export function ComponentGraph({ root, path, onBack }: ComponentGraphProps) {
  // Caches file reads and parses for as long as this page is open.
  const project = useMemo(() => createProject((file) => tryReadFileAtPath(root, file)), [root]);
  const [tree, setTree] = useState<Tree>(() => ({
    [ROOT_ID]: {
      id: ROOT_ID,
      name: path,
      source: path,
      location: { kind: "file", path },
      cycle: false,
      expanded: true,
      children: { status: "idle" },
    },
  }));

  const load = useCallback(
    async (id: string, file: string) => {
      const setChildren = (children: Children) =>
        setTree((tree) => ({ ...tree, [id]: { ...tree[id], children } }));
      setChildren({ status: "loading" });
      try {
        const { components, syntaxErrors } = await project.listComponents(file);
        const locations = await Promise.all(
          components.map((component) => project.locate(file, component)),
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
              cycle: location.kind === "file" && openPaths.has(location.path),
              expanded: false,
              children: { status: "idle" },
            };
            return childId;
          });
          next[id] = { ...next[id], children: { status: "ready", ids, syntaxErrors } };
          return next;
        });
      } catch (error) {
        setChildren({ status: "error", message: String(error) });
      }
    },
    [project],
  );

  useEffect(() => {
    void load(ROOT_ID, path);
  }, [load, path]);

  const toggle = useCallback(
    (id: string) => {
      const node = tree[id];
      if (!canExpand(node) || node.location.kind !== "file") return;
      setTree((tree) => ({ ...tree, [id]: { ...tree[id], expanded: !tree[id].expanded } }));
      if (!node.expanded && (node.children.status === "idle" || node.children.status === "error")) {
        void load(id, node.location.path);
      }
    },
    [tree, load],
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
  const kind = node.id === ROOT_ID ? "page" : node.cycle ? "cycle" : node.location.kind;
  const content = (
    <>
      <span className="graph-node-name">{node.name}</span>
      <span className="graph-node-indicator" aria-hidden>
        {indicator(node)}
      </span>
    </>
  );

  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {canExpand(node) && node.id !== ROOT_ID ? (
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
    </ul>
  );
}
