/**
 * The lines a person pastes into Claude Code to have the setup program run
 * for them, and what their cards say of them: one that sets up chuggy for the
 * repository in the folder it is open in, and one that makes the machine it is
 * open on the person's chat host in a workspace.
 *
 * The first line is the same text for every reader of a site. It carries the
 * site's own address and the path the site serves the setup program at, and
 * nothing of who is reading: no workspace and no project, which the program
 * reads and asks for where it cannot tell. The second names its workspace
 * too, and neither carries a token, since the program signs in and mints its
 * own.
 */

import type { Copy } from "./copy.ts";
import { setupProgramPath } from "./setupProgram.ts";

/** Where the line has the program kept: the person's home, as a file of its own. */
const claudeCodeLineScript = "~/.chuggy-setup.mjs";

/** The command that fetches the site at `origin`'s own program to where a line runs it from. */
function claudeCodeLineFetched(origin: string): string {
  return `curl -fsS ${origin}${setupProgramPath} -o ${claudeCodeLineScript}`;
}

/** The line for the site at `origin`, which fetches that site's own program and runs it against that site. */
export function claudeCodeLine(origin: string): string {
  const run = `node ${claudeCodeLineScript} --site ${origin}`;
  return `Set up chuggy for the repository in this folder: run "${claudeCodeLineFetched(origin)} && ${run}" and do what its output says.`;
}

/** The line that has the program fetched as `claudeCodeLine` has it make this machine the person's chat host in `tenant`. */
export function claudeCodeChatHostLine(origin: string, tenant: string): string {
  const run = `node ${claudeCodeLineScript} chat-host --site ${origin} --workspace ${tenant}`;
  return `Make this machine my chuggy chat host: run "${claudeCodeLineFetched(origin)} && ${run}" and do what its output says.`;
}

/** What the card says of the line: where it is pasted, and where the reader is when it is. */
export const claudeCodeLineAbout: Copy = { id: "chat-claude-code-about" };

/** What the card says of the chat host's line: that it is pasted on the machine that will be the chat host. */
export const claudeCodeChatHostLineAbout: Copy = {
  id: "runners-chat-host-claude-code-about",
};

/** What the control that copies either line is called. */
export const claudeCodeLineCopy: Copy = { id: "chat-claude-code-copy" };
