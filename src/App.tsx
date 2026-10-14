import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { loadRootHandle, saveRootHandle } from "./fs/handleStore.ts";
import { PAGE_FILE_NAME, scanPages } from "./fs/scanPages.ts";
import { loadSelectedPath, saveSelectedPath } from "./fs/selectionStore.ts";
import { filterPaths, type PathMatch } from "./search/filterPaths.ts";
import { ComponentGraph } from "./graph/ComponentGraph.tsx";
import "./App.css";

// Rendering thousands of rows at once makes typing sluggish.
const MAX_VISIBLE_RESULTS = 500;
const NO_PATHS: string[] = [];

type FolderState =
  | { status: "empty" }
  | { status: "needs-permission"; handle: FileSystemDirectoryHandle }
  | { status: "scanning"; handle: FileSystemDirectoryHandle }
  | { status: "ready"; handle: FileSystemDirectoryHandle; paths: string[] }
  | { status: "error"; message: string };

const isSupported = typeof window.showDirectoryPicker === "function";

function App() {
  const [folder, setFolder] = useState<FolderState>({ status: "empty" });
  const [query, setQuery] = useState("");
  // The last visited page, pinned at the top of the list.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // The page whose graph is shown full-width, hiding the list.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!isSupported) return;
    let cancelled = false;
    void (async () => {
      const handle = await loadRootHandle();
      if (!handle || cancelled) return;
      // Permission doesn't survive a reload; re-requesting needs a user click.
      if ((await handle.queryPermission({ mode: "read" })) === "granted") {
        if (!cancelled) void scan(handle);
      } else if (!cancelled) {
        setFolder({ status: "needs-permission", handle });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function scan(handle: FileSystemDirectoryHandle) {
    setFolder({ status: "scanning", handle });
    setSelectedPath(null);
    setOpenPath(null);
    try {
      const paths = await scanPages(handle);
      setFolder({ status: "ready", handle, paths });
      const savedPath = loadSelectedPath();
      if (savedPath !== null && paths.includes(savedPath)) {
        setSelectedPath(savedPath);
        setOpenPath(savedPath);
      }
    } catch (error) {
      setFolder({ status: "error", message: String(error) });
    }
  }

  async function pickFolder() {
    try {
      const handle = await window.showDirectoryPicker!({ id: "code-explorer", mode: "read" });
      await saveRootHandle(handle);
      saveSelectedPath(null);
      setQuery("");
      await scan(handle);
    } catch (error) {
      // The user closing the picker is not an error.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFolder({ status: "error", message: String(error) });
    }
  }

  async function reopenFolder(handle: FileSystemDirectoryHandle) {
    if ((await handle.requestPermission({ mode: "read" })) === "granted") {
      await scan(handle);
    }
  }

  function openPage(path: string) {
    setSelectedPath(path);
    setOpenPath(path);
    saveSelectedPath(path);
  }

  const paths = folder.status === "ready" ? folder.paths : NO_PATHS;
  const matches = useMemo(
    () => filterPaths(paths, deferredQuery, selectedPath),
    [paths, deferredQuery, selectedPath],
  );

  if (!isSupported) {
    return (
      <main className="app">
        <h1>Code Explorer</h1>
        <p className="notice">
          This browser can't open local folders. Use a Chromium-based browser (Chrome, Edge, Arc).
        </p>
      </main>
    );
  }

  return (
    <main className={openPath ? "app graph-open" : "app"}>
      <header className="toolbar">
        <h1>Code Explorer</h1>
        <div className="toolbar-actions">
          {folder.status === "needs-permission" && (
            <button type="button" onClick={() => void reopenFolder(folder.handle)}>
              Reopen {folder.handle.name}
            </button>
          )}
          <button type="button" onClick={() => void pickFolder()}>
            {folder.status === "empty" || folder.status === "error"
              ? "Choose folder"
              : "Change folder"}
          </button>
        </div>
      </header>

      {folder.status === "empty" && (
        <p className="notice">Choose a code repository to search its {PAGE_FILE_NAME} files.</p>
      )}
      {folder.status === "error" && <p className="notice error">{folder.message}</p>}
      {folder.status === "scanning" && <p className="notice">Scanning {folder.handle.name}…</p>}

      {folder.status === "ready" && openPath && (
        <ComponentGraph
          key={openPath}
          root={folder.handle}
          path={openPath}
          onBack={() => setOpenPath(null)}
        />
      )}

      {folder.status === "ready" && !openPath && (
        <>
          <input
            className="search"
            type="search"
            placeholder={`Search ${PAGE_FILE_NAME} paths in ${folder.handle.name}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            spellCheck={false}
          />
          <p className="count">
            {matches.length} of {paths.length} {PAGE_FILE_NAME} files
            {matches.length > MAX_VISIBLE_RESULTS && ` (showing first ${MAX_VISIBLE_RESULTS})`}
          </p>
          <ul className="results">
            {matches.slice(0, MAX_VISIBLE_RESULTS).map((match) => (
              <li key={match.path}>
                <button
                  type="button"
                  className="result"
                  aria-pressed={match.path === selectedPath}
                  onClick={() => openPage(match.path)}
                >
                  <HighlightedPath match={match} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function HighlightedPath({ match: { path, start, end } }: { match: PathMatch }) {
  if (start === -1) return <code>{path}</code>;
  return (
    <code>
      {path.slice(0, start)}
      <mark>{path.slice(start, end)}</mark>
      {path.slice(end)}
    </code>
  );
}

export default App;
