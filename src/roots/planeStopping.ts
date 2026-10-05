/**
 * How a plane's process ends when its supervisor asks it to.
 *
 * A PLANE STOPS ACCEPTING AND FINISHES WHAT IT HOLDS. Closing the app refuses
 * new connections and waits for every request in flight, and the pool ends
 * once the last of them has answered, so nothing a caller was already owed is
 * cut off.
 *
 * A CONNECTION IS CLOSED AS IT FALLS IDLE, because closing the app closes only
 * the ones idle at that moment. A caller that kept its connection after its
 * request was answered would otherwise hold the process open until the
 * supervisor killed it.
 *
 * THE WAIT HAS NO BOUND OF ITS OWN. A request a plane holds open by design, a
 * mailbox or a poll waiting for work, answers empty when its window is spent,
 * and past that the supervisor's grace period is the bound it always was.
 */

import type { FastifyInstance } from "fastify";

/** How often a stopping plane closes the connections that have fallen idle. */
const idleSweepMs = 100;

async function planeClosed(app: FastifyInstance): Promise<void> {
  const sweep = setInterval(() => {
    app.server.closeIdleConnections();
  }, idleSweepMs);
  try {
    await app.close();
  } finally {
    clearInterval(sweep);
  }
}

/** Ends the pool as the app closes, and closes the app on either signal a supervisor stops a process with. */
export function planeStopping(
  app: FastifyInstance,
  pool: { end(): Promise<void> },
  plane: string,
): void {
  app.addHook("onClose", () => pool.end());
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void planeClosed(app).catch((failure: unknown) => {
        const message =
          failure instanceof Error ? failure.message : "unknown failure";
        process.stderr.write(`${plane} shutdown: ${message}\n`);
        process.exitCode = 1;
      });
    });
  }
}
