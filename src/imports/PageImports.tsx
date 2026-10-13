import { useEffect, useState } from "react";
import { readFileAtPath } from "../fs/readFile.ts";
import { parseSource } from "../parser/parseSource.ts";
import { isLocalSource, listImports, type ImportEntry } from "./listImports.ts";

type ImportsState =
  | { status: "loading" }
  | { status: "ready"; imports: ImportEntry[]; syntaxErrors: number }
  | { status: "error"; message: string };

const KIND_LABELS: Record<ImportEntry["kind"], string | null> = {
  static: null,
  "side-effect": "side effect",
  "re-export": "re-export",
  dynamic: "dynamic",
};

interface PageImportsProps {
  root: FileSystemDirectoryHandle;
  path: string;
  onClose: () => void;
}

/** Reads `path` and lists its imports. Remount (via `key`) to load another file. */
export function PageImports({ root, path, onClose }: PageImportsProps) {
  const [state, setState] = useState<ImportsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const code = await readFileAtPath(root, path);
        const { module, errors } = await parseSource(path, code);
        if (cancelled) return;
        setState({
          status: "ready",
          imports: listImports(module, code),
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
    <section className="imports" aria-label={`Imports of ${path}`}>
      <header className="imports-header">
        <div>
          <h2>
            <code>{path}</code>
          </h2>
          <p className="count">
            {state.status === "loading" && "Reading…"}
            {state.status === "ready" &&
              `${state.imports.length} ${state.imports.length === 1 ? "import" : "imports"}`}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close imports">
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
      {state.status === "ready" && state.imports.length === 0 && (
        <p className="notice">This page has no imports.</p>
      )}
      {state.status === "ready" && state.imports.length > 0 && (
        <ul className="import-list">
          {state.imports.map((entry, index) => (
            <li key={index}>
              <div className="import-source">
                <code className={isLocalSource(entry.source) ? "local" : "package"}>
                  {entry.source}
                </code>
                {entry.typeOnly && <span className="tag">type</span>}
                {KIND_LABELS[entry.kind] && <span className="tag">{KIND_LABELS[entry.kind]}</span>}
                <span className="line">L{entry.line}</span>
              </div>
              {entry.names.length > 0 && (
                <code className="import-names">{entry.names.join(", ")}</code>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
