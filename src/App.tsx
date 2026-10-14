import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { loadRootHandle, saveRootHandle } from "./fs/handleStore.ts";
import { PAGE_FILE_NAME, scanRepository } from "./fs/scanPages.ts";
import { addRecentPath, loadRecentPaths, saveRecentPaths } from "./fs/recentStore.ts";
import { filterPaths, splitRecent, type PathMatch } from "./search/filterPaths.ts";
import { ComponentGraph } from "./graph/ComponentGraph.tsx";
import "./App.css";

// Rendering thousands of rows at once makes typing sluggish.
const MAX_VISIBLE_RESULTS = 500;
const NO_PATHS: string[] = [];

type FolderState =
  | { status: "empty" }
  | { status: "needs-permission"; handle: FileSystemDirectoryHandle }
  | { status: "scanning"; handle: FileSystemDirectoryHandle }
  | {
      status: "ready";
      handle: FileSystemDirectoryHandle;
      paths: string[];
      packageDirs: string[];
    }
  | { status: "error"; message: string };

const isSupported = typeof window.showDirectoryPicker === "function";

function App() {
  const [folder, setFolder] = useState<FolderState>({ status: "empty" });
  const [query, setQuery] = useState("");
  // The last visited pages, most recent first, listed above the other pages.
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
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
    setRecentPaths([]);
    setOpenPath(null);
    try {
      const { pages: paths, packageDirs } = await scanRepository(handle);
      setFolder({ status: "ready", handle, paths, packageDirs });
      const pathSet = new Set(paths);
      const recent = loadRecentPaths().filter((path) => pathSet.has(path));
      setRecentPaths(recent);
      if (recent.length > 0) setOpenPath(recent[0]);
    } catch (error) {
      setFolder({ status: "error", message: String(error) });
    }
  }

  async function pickFolder() {
    try {
      const handle = await window.showDirectoryPicker!({ id: "code-explorer", mode: "read" });
      await saveRootHandle(handle);
      saveRecentPaths([]);
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
    const recent = addRecentPath(recentPaths, path);
    setRecentPaths(recent);
    setOpenPath(path);
    saveRecentPaths(recent);
  }

  const paths = folder.status === "ready" ? folder.paths : NO_PATHS;
  const matches = useMemo(() => filterPaths(paths, deferredQuery), [paths, deferredQuery]);
  const { recent: recentMatches, others: otherMatches } = useMemo(
    () => splitRecent(matches, recentPaths),
    [matches, recentPaths],
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
          packageDirs={folder.packageDirs}
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
            {otherMatches.length > MAX_VISIBLE_RESULTS &&
              ` (showing first ${MAX_VISIBLE_RESULTS} of the rest)`}
          </p>
          {recentMatches.length > 0 && (
            <section className="result-group">
              <h2>Recently visited</h2>
              <ResultList matches={recentMatches} lastVisited={recentPaths[0]} onOpen={openPage} />
            </section>
          )}
          {otherMatches.length > 0 && (
            <section className="result-group">
              {recentMatches.length > 0 && <h2>All pages</h2>}
              <ResultList
                matches={otherMatches.slice(0, MAX_VISIBLE_RESULTS)}
                lastVisited={recentPaths[0]}
                onOpen={openPage}
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}

function ResultList({
  matches,
  lastVisited,
  onOpen,
}: {
  matches: PathMatch[];
  lastVisited: string | undefined;
  onOpen: (path: string) => void;
}) {
  return (
    <ul className="results">
      {matches.map((match) => (
        <li key={match.path}>
          <button
            type="button"
            className="result"
            aria-pressed={match.path === lastVisited}
            onClick={() => onOpen(match.path)}
          >
            <HighlightedPath match={match} />
          </button>
        </li>
      ))}
    </ul>
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
