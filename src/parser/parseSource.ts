import type { ParseResult } from "oxc-parser";

type OxcParser = typeof import("oxc-parser");

let parserPromise: Promise<OxcParser> | undefined;

// The browser build fetches a ~1.5 MB .wasm file when first imported, so it
// is only loaded once a page is actually opened.
function loadParser(): Promise<OxcParser> {
  return (parserPromise ??= import("oxc-parser"));
}

/**
 * Parses a JS/TS(X) file into an ESTree AST plus module import/export info.
 * The language is inferred from `path`'s extension.
 */
export async function parseSource(path: string, code: string): Promise<ParseResult> {
  const { parseSync } = await loadParser();
  return parseSync(path, code);
}
