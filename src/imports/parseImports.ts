export type ImportKind = "static" | "side-effect" | "re-export" | "dynamic";

export interface ImportEntry {
  /** The module specifier, e.g. `react` or `../components/Button`. */
  source: string;
  kind: ImportKind;
  /** `import type …` / `export type … from` */
  typeOnly: boolean;
  /** Bindings as written: `React`, `* as path`, `useState`, `type FC`, `a as b`. */
  names: string[];
  /** 1-based line of the `import` / `export` keyword. */
  line: number;
}

// Characters after which a `/` starts a regex literal rather than a division.
const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";"]);

/**
 * Replaces every comment with spaces (keeping newlines, so indices and line
 * numbers are unchanged) so commented-out imports aren't reported. Strings,
 * template literals and regex literals are skipped so `"http://…"` isn't
 * mistaken for a comment.
 */
export function maskComments(code: string): string {
  const out = code.split("");
  const len = code.length;
  // Brace depth at which each open template's `${` started.
  const templateStack: number[] = [];
  let braceDepth = 0;
  let prev = "";
  let i = 0;

  // Scans template text from `i` up to and including the closing backtick or
  // an opening `${`, returning the index just after it.
  const scanTemplate = (start: number): number => {
    let j = start;
    while (j < len) {
      if (code[j] === "\\") j += 2;
      else if (code[j] === "`") return j + 1;
      else if (code[j] === "$" && code[j + 1] === "{") {
        templateStack.push(braceDepth++);
        return j + 2;
      } else j++;
    }
    return j;
  };

  while (i < len) {
    const ch = code[i];
    const next = code[i + 1];

    if (ch === "/" && next === "/") {
      while (i < len && code[i] !== "\n") out[i++] = " ";
    } else if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? len : end + 2;
      for (; i < stop; i++) if (code[i] !== "\n") out[i] = " ";
    } else if (ch === "'" || ch === '"') {
      // Unterminated quotes (e.g. an apostrophe in JSX text) stop at the line end.
      i++;
      while (i < len && code[i] !== ch && code[i] !== "\n") i += code[i] === "\\" ? 2 : 1;
      i++;
      prev = ch;
    } else if (ch === "`") {
      i = scanTemplate(i + 1);
      prev = ch;
    } else if (ch === "/" && REGEX_PRECEDERS.has(prev)) {
      let inClass = false;
      i++;
      while (i < len && code[i] !== "\n" && (inClass || code[i] !== "/")) {
        if (code[i] === "\\") i++;
        else if (code[i] === "[") inClass = true;
        else if (code[i] === "]") inClass = false;
        i++;
      }
      i++;
      prev = "/";
    } else {
      if (ch === "{") braceDepth++;
      else if (ch === "}") {
        braceDepth--;
        if (templateStack.at(-1) === braceDepth) {
          templateStack.pop();
          i = scanTemplate(i + 1);
          prev = "`";
          continue;
        }
      }
      if (!/\s/.test(ch)) prev = ch;
      i++;
    }
  }
  return out.join("");
}

const STATIC_IMPORT =
  /^[ \t]*import\s+(?:(type)\s+)?([\w$*{][^;'"]*?)\s*from\s*(['"])([^'"\n]+)\3/gm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import\s*(['"])([^'"\n]+)\1/gm;
const RE_EXPORT =
  /^[ \t]*export\s+(?:(type)\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\3/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"`])([^'"`\n]+)\1\s*[,)]/g;

function splitList(list: string): string[] {
  return list
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/** `React, { useState as useS, type FC }` → `["React", "useState as useS", "type FC"]` */
export function parseBindings(clause: string): string[] {
  const open = clause.indexOf("{");
  if (open === -1) return splitList(clause);
  const close = clause.indexOf("}", open);
  return [
    ...splitList(clause.slice(0, open)),
    ...splitList(clause.slice(open + 1, close === -1 ? undefined : close)),
  ];
}

/**
 * Lists the modules a TS/JS(X) source file imports, in source order:
 * static imports, side-effect imports, `export … from` re-exports and
 * dynamic `import("…")` calls with a literal specifier.
 *
 * This is a lightweight scanner, not a full parser: it ignores comments but
 * would still pick up import-like text inside multi-line template strings.
 */
export function parseImports(code: string): ImportEntry[] {
  const masked = maskComments(code);
  const found: { index: number; entry: Omit<ImportEntry, "line"> }[] = [];

  // Point at the keyword, not the leading indentation the patterns consume.
  const keywordIndex = (match: RegExpExecArray, keyword: string) =>
    match.index + match[0].indexOf(keyword);

  for (const match of masked.matchAll(STATIC_IMPORT)) {
    found.push({
      index: keywordIndex(match, "import"),
      entry: {
        source: match[4],
        kind: "static",
        typeOnly: match[1] === "type",
        names: parseBindings(match[2]),
      },
    });
  }
  for (const match of masked.matchAll(SIDE_EFFECT_IMPORT)) {
    found.push({
      index: keywordIndex(match, "import"),
      entry: { source: match[2], kind: "side-effect", typeOnly: false, names: [] },
    });
  }
  for (const match of masked.matchAll(RE_EXPORT)) {
    found.push({
      index: keywordIndex(match, "export"),
      entry: {
        source: match[4],
        kind: "re-export",
        typeOnly: match[1] === "type",
        names: parseBindings(match[2]),
      },
    });
  }
  for (const match of masked.matchAll(DYNAMIC_IMPORT)) {
    found.push({
      index: match.index,
      entry: { source: match[2], kind: "dynamic", typeOnly: false, names: [] },
    });
  }

  found.sort((a, b) => a.index - b.index);

  // Compute line numbers in one pass over the (sorted) match positions.
  let line = 1;
  let cursor = 0;
  return found.map(({ index, entry }) => {
    for (; cursor < index; cursor++) if (code[cursor] === "\n") line++;
    return { ...entry, line };
  });
}

/** Relative paths and common path aliases (`@/`, `~/`, `#`) point into the repo. */
export function isLocalSource(source: string): boolean {
  return /^(\.{1,2}\/|\/|@\/|~\/|#)/.test(source) || source === "." || source === "..";
}
