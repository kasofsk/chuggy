/**
 * The harness as a process: what it is invoked as, and the one invocation that
 * runs nothing.
 *
 * `--self-check` EXISTS FOR THE INSTALLER THAT HAS NO IMAGE TO TRUST. A pool
 * placing this harness under a process driver fetches a pinned source archive
 * onto a host and has nothing that says the host can run it; loading this
 * module is what says so, because every part of the harness is imported by the
 * time an argument is read. So the check runs the graph and exits, and an
 * installation that cannot reach this line has a release it must not run.
 */
import { pathToFileURL } from "node:url";

import {
  ticketWorkerMain,
  ticketWorkerResultMcpMain,
} from "../adapters/runtime/ticketWorker.ts";

export { ticketWorkerMain, ticketWorkerResultMcpMain };

/** What one invocation runs, which for the self-check is the loading it has already done. */
function ticketWorkerInvoked(argv: readonly string[]): Promise<unknown> {
  if (argv.includes("--self-check")) return Promise.resolve(undefined);
  return argv.includes("--result-mcp")
    ? ticketWorkerResultMcpMain(argv.slice(2))
    : ticketWorkerMain(process.env);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await ticketWorkerInvoked(process.argv).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "ticket worker failed"}\n`,
    );
    process.exitCode = 1;
  });
