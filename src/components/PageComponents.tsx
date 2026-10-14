import { useEffect, useState } from "react";
import { readFileAtPath } from "../fs/readFile.ts";
import { parseSource } from "../parser/parseSource.ts";
import { isLocalSource, listComponents, type RenderedComponent } from "./listComponents.ts";

type ComponentsState =
  | { status: "loading" }
  | { status: "ready"; components: RenderedComponent[]; syntaxErrors: number }
  | { status: "error"; message: string };

interface PageComponentsProps {
  root: FileSystemDirectoryHandle;
  path: string;
  onClose: () => void;
}

/** Reads `path` and lists the imported components it renders. Remount (via `key`) to load another file. */
export function PageComponents({ root, path, onClose }: PageComponentsProps) {
  const [state, setState] = useState<ComponentsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const code = await readFileAtPath(root, path);
        const { program, module, errors } = await parseSource(path, code);
        if (cancelled) return;
        setState({
          status: "ready",
          components: listComponents(program, module, code),
          syntaxErrors: errors.filter((error) => error.severity === "Error").length,
        });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root, path]);

  return (
    <section className="components" aria-label={`Components rendered by ${path}`}>
      <header className="components-header">
        <div>
          <h2>
            <code>{path}</code>
          </h2>
          <p className="count">
            {state.status === "loading" && "Reading…"}
            {state.status === "ready" &&
              `${state.components.length} ${state.components.length === 1 ? "component" : "components"}`}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close components">
          ✕
        </button>
      </header>

      {state.status === "error" && <p className="notice error">{state.message}</p>}
      {state.status === "ready" && state.syntaxErrors > 0 && (
        <p className="notice error">
          {state.syntaxErrors} syntax {state.syntaxErrors === 1 ? "error" : "errors"} in this file;
          the list may be incomplete.
        </p>
      )}
      {state.status === "ready" && state.components.length === 0 && (
        <p className="notice">This page renders no imported components.</p>
      )}
      {state.status === "ready" && state.components.length > 0 && (
        <ul className="component-list">
          {state.components.map((component) => (
            <li key={component.name}>
              <div className="component-row">
                <code className="local">{component.name}</code>
                {component.count > 1 && <span className="tag">×{component.count}</span>}
                <span className="line">L{component.line}</span>
              </div>
              <code
                className={`component-source ${isLocalSource(component.import.source) ? "local" : "package"}`}
              >
                {component.import.source}
              </code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
