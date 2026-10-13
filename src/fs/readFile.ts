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
