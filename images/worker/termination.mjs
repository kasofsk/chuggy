/**
 * What a signalled attempt still owes, and the one place that pays it.
 *
 * A `finally` DOES NOT RUN WHEN THE PROCESS IS SIGNALLED. The scheduler deletes
 * a pod to cancel an attempt, and the kubelet's SIGTERM ends this process
 * without unwinding the stack: whatever the attempt made on the shared server
 * outlives it, owned by a role no longer named by any pod. Node runs a signal
 * handler instead, so the release the `finally` would have run is registered
 * here as well.
 *
 * IT IS PAID ONCE, WHICHEVER PATH REACHES IT. Both paths call the same
 * function, and a release already under way is awaited rather than started
 * again — a second DROP against a database the first is removing is a failure
 * on the way out, which is the least useful moment to raise one.
 *
 * THE GRACE PERIOD BOUNDS IT AND NOTHING HERE DOES. SIGKILL follows SIGTERM by
 * whatever the pod spec allows, and a release still running when it lands is a
 * leak this cannot prevent — nor can it prevent a node that stops. So the sweep
 * in `deploy/rig/postgres/README.md` remains the backstop; this narrows what
 * reaches it to what was actually killed rather than merely cancelled.
 */

/** The signals a container is stopped by, which Node would otherwise exit on. */
export const terminationSignals = ["SIGTERM", "SIGINT"];

/**
 * Registers the release, and answers with the function both paths call.
 * @param {() => Promise<void>} release
 * @param {{
 *   on: (signal: string, handler: () => void) => void,
 *   exit: (code: number) => void,
 *   report: (message: string) => void,
 * }} services
 * @returns {() => Promise<void>}
 */
export function releaseOnTermination(release, services) {
  /** @type {Promise<void> | undefined} */
  let releasing;
  const once = async () => {
    releasing ??= release();
    await releasing;
  };
  for (const signal of terminationSignals)
    services.on(signal, () => {
      void (async () => {
        services.report(`${signal}: releasing the attempt before exiting`);
        try {
          await once();
        } catch (failure) {
          services.report(
            `${signal}: release failed: ${failure instanceof Error ? failure.message : "unknown"}`,
          );
        }
        services.exit(1);
      })();
    });
  return once;
}
