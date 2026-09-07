/**
 * The PostgreSQL one attempt runs its gates against: a server of the pod's
 * own, beside this container, that the worker is superuser of.
 *
 * A repository's gates migrate the server they are pointed at, and a migration
 * makes cluster-wide roles and hands objects to them: an authority over the
 * whole server, which agent-authored code can hold only on a server that holds
 * nothing else. This one is reached on the pod's loopback alone and ends with
 * the pod. It is already answering when this runs — the pod starts this
 * container only after the sidecar's startup probe has seen it accept a
 * connection — so what is handed to the gates is the URL as given, under the
 * gates' own name.
 */

/**
 * @param {Record<string, string | undefined>} environment
 * @param {string} url
 */
export function attemptDatabase(environment, url) {
  environment["CHUG_PG_URL"] = url;
  if (!environment["CHUG_PG_WORKERS"]) environment["CHUG_PG_WORKERS"] = "1";
  delete environment["CHUG_WORKER_DATABASE_URL"];
}
