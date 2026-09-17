import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The image's default entrypoint serves sessions; ticket pods invoke their root directly. */
export function workerMode(environment) {
  const session = environment.CHUG_SESSION_TASK;
  if (typeof session === "string" && session.length > 0) return "Session";
  throw new Error("a pod needs CHUG_SESSION_TASK");
}

async function run() {
  workerMode(process.env);
  const { sessionMain } = await import("./session.mjs");
  process.exitCode = await sessionMain();
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  run().catch((failure) => {
    const message =
      failure instanceof Error ? failure.message : "session failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
