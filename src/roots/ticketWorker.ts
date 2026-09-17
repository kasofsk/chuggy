import { pathToFileURL } from "node:url";

import {
  ticketWorkerMain,
  ticketWorkerResultMcpMain,
} from "../adapters/runtime/ticketWorker.ts";

export { ticketWorkerMain, ticketWorkerResultMcpMain };

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await (
    process.argv.includes("--result-mcp")
      ? ticketWorkerResultMcpMain(process.argv.slice(2))
      : ticketWorkerMain(process.env)
  ).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "ticket worker failed"}\n`,
    );
    process.exitCode = 1;
  });
