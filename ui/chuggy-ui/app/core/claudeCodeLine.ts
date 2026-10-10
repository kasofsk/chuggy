/**
 * The line a person pastes into Claude Code to have chuggy set up for the
 * repository in the folder it is open in, and what its card says of it.
 *
 * The line is the same text for every reader of a site. It carries the site's
 * own address and the path the site serves the setup program at, and nothing
 * of who is reading: no workspace and no project, which the program reads and
 * asks for where it cannot tell.
 */

import { setupProgramPath } from "./setupProgram.ts";

/** Where the line has the program kept: the person's home, as a file of its own. */
const claudeCodeLineScript = "~/.chuggy-setup.mjs";

/** The line for the site at `origin`, which fetches that site's own program and runs it against that site. */
export function claudeCodeLine(origin: string): string {
  const fetched = `curl -fsS ${origin}${setupProgramPath} -o ${claudeCodeLineScript}`;
  const run = `node ${claudeCodeLineScript} --site ${origin}`;
  return `Set up chuggy for the repository in this folder: run "${fetched} && ${run}" and do what its output says.`;
}

/** What the card says of the line: where it is pasted, and where the reader is when it is. */
export const claudeCodeLineAbout = "Claude Code · in your repository's folder";

/** What the control that copies the line is called. */
export const claudeCodeLineCopy = "Copy prompt";
