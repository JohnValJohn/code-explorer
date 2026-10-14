/** Reads the text of the file at a root-relative `a/b/c.tsx` path. */
export async function readFileAtPath(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<string> {
  const segments = path.split("/");
  const fileName = segments.pop()!;
  let dir = root;
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment);
  }
  const file = await (await dir.getFileHandle(fileName)).getFile();
  return file.text();
}

/** Like `readFileAtPath`, but returns null when the path isn't an existing file. */
export async function tryReadFileAtPath(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<string | null> {
  try {
    return await readFileAtPath(root, path);
  } catch (error) {
    // NotFoundError: missing; TypeMismatchError: a directory where a file was expected (or vice versa).
    if (
      error instanceof DOMException &&
      (error.name === "NotFoundError" || error.name === "TypeMismatchError")
    ) {
      return null;
    }
    throw error;
  }
}
