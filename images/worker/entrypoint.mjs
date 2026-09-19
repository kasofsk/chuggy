import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Which of the image's two roots a pod is asking for, decided by the task the
 * launcher put in the environment. A ticket pod used to be launched by an argv
 * a ticket authored, which is how a ticket came to dictate one operator's
 * filesystem layout; the image knows its own layout, so it is the image that
 * says how each mode starts.
 */
export function workerMode(environment) {
  const session = environment.CHUG_SESSION_TASK;
  if (typeof session === "string" && session.length > 0) return "Session";
  const ticket = environment.CHUG_TICKET_WORKER_TASK;
  if (typeof ticket === "string" && ticket.length > 0) return "Ticket";
  throw new Error("a pod needs CHUG_SESSION_TASK or CHUG_TICKET_WORKER_TASK");
}

/** Where the ticket worker's root lives, which the image sets and a site may move. */
export function ticketWorkerEntrypoint(environment) {
  const named = environment.CHUG_TICKET_WORKER_ENTRYPOINT;
  if (typeof named !== "string" || named.length === 0)
    throw new Error("a ticket pod needs CHUG_TICKET_WORKER_ENTRYPOINT");
  return named;
}

async function run() {
  if (workerMode(process.env) === "Ticket") {
    const { ticketWorkerMain } = await import(
      pathToFileURL(ticketWorkerEntrypoint(process.env)).href
    );
    await ticketWorkerMain(process.env);
    return;
  }
  const { sessionMain } = await import("./session.mjs");
  process.exitCode = await sessionMain();
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  run().catch((failure) => {
    const message =
      failure instanceof Error ? failure.message : "worker failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
