/**
 * The worker that colours code: every block `markdownSyntax.ts` asks about is
 * read here, on a thread no reader is waiting on.
 *
 * It says it is ready once its grammars are loaded, which is when the page
 * starts counting how long an answer takes.
 */

import { markdownSyntaxAnswered } from "./markdownSyntaxRead.ts";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const answer = markdownSyntaxAnswered(event.data);
  if (answer !== undefined) self.postMessage(answer);
});

self.postMessage({ ready: true });
