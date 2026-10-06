/**
 * What a directory of declarations in a repository's tree is read by, whatever
 * its documents declare: the file its reader hands over, where such a file may
 * sit, and how much of a tree one read takes.
 *
 * THE BOUNDS ARE THE READ'S AND NOT A KIND OF DOCUMENT'S. They cap what one
 * read of one directory takes out of a tree and what one import then stores,
 * which is the same question whatever the directory declares, so a kind that
 * kept its own would hold a copy to keep in step with its reader's.
 */

import { textCodePointsCount } from "../contract/http.ts";

/** One blob a tree holds under a declaration directory, as its reader found it. */
export interface RepositoryDeclarationFile {
  readonly path: string;
  readonly kind: "File" | "Symlink";
  readonly content: string;
}

export const repositoryDeclarationsMax = 100;
export const repositoryDeclarationPathCharsMax = 256;
export const repositoryDeclarationFileCharsMax = 65_536;

/** Whether `path` is a JSON file directly in the directory `root` names, within the path bound. */
export function isRepositoryDeclarationPath(
  root: string,
  path: string,
): boolean {
  const file = path.slice(root.length);
  return (
    path.startsWith(root) &&
    textCodePointsCount(path) <= repositoryDeclarationPathCharsMax &&
    path.isWellFormed() &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    file.endsWith(".json") &&
    file.length > ".json".length &&
    !file.includes("/")
  );
}

/** Why a file's content is refused before any document is read from it. */
export type RepositoryDeclarationContentFault =
  "SymlinkRefused" | "ContentTooLarge" | "DocumentUnreadable";

export type RepositoryDeclarationContent =
  | { readonly content: "Document"; readonly document: unknown }
  | {
      readonly content: "Refused";
      readonly fault: RepositoryDeclarationContentFault;
    };

/** The JSON one declaration file holds, or why its content is refused before a document is read from it. */
export function repositoryDeclarationContent(
  file: RepositoryDeclarationFile,
): RepositoryDeclarationContent {
  if (file.kind === "Symlink")
    return { content: "Refused", fault: "SymlinkRefused" };
  if (textCodePointsCount(file.content) > repositoryDeclarationFileCharsMax)
    return { content: "Refused", fault: "ContentTooLarge" };
  try {
    return { content: "Document", document: JSON.parse(file.content) };
  } catch {
    return { content: "Refused", fault: "DocumentUnreadable" };
  }
}
