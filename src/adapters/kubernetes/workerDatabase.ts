/**
 * The PostgreSQL an attempt's gates run against, as the sidecar a pod that runs
 * a worker carries where its site names one: a pushed worker's pod and a pool's
 * workload alike, since the harness reads the server's address from the one
 * variable whichever of the two placed it.
 *
 * A WORKER'S POSTGRESQL IS A SIDECAR, AND THE WORKER IS ITS SUPERUSER. The
 * gates a repository runs against a server migrate it, and a migration makes
 * and alters cluster-wide roles: run on a server the attempt shares with
 * anything else, it needs an authority over that server's roles that nothing
 * agent-authored can be given. So the server is the attempt's alone — a
 * container beside the worker's, listening on the pod's own loopback, holding
 * nothing before the attempt and nothing after it — and what would have been a
 * credential is a fixed address. It is a sidecar rather than a second
 * container so that the pod ends when the worker does.
 *
 * A SITE THAT NAMES NO DATABASE GETS NONE OF IT. Each part below is a list that
 * is empty where the site runs no server, so a pod placed without one carries
 * no sidecar, no volume for it and no address for its worker to reach.
 */

import { workerDatabaseUrlVariable } from "../../contract/workerEnvironment.ts";
import {
  kubernetesContainerResources,
  type KubernetesContainer,
  type KubernetesContainerVariable,
  type KubernetesPod,
  type KubernetesPodSite,
  type KubernetesResourceBudget,
} from "./kubernetesSite.ts";

/** The PostgreSQL image an attempt's sidecar runs, and what that container may use. */
export interface KubernetesWorkerDatabase {
  readonly image: string;
  readonly resources: KubernetesResourceBudget;
}

/** The container name the attempt's PostgreSQL runs under, beside the worker's. */
export const kubernetesWorkerDatabaseContainerName = "postgres";

/**
 * Where the sidecar answers and what it answers as: the pod's loopback, which
 * only this pod's containers reach, and the server's own superuser with no
 * password, because there is nothing in the pod the worker is not.
 */
export const kubernetesWorkerDatabaseUrl =
  "postgres://postgres@127.0.0.1:5432/postgres";

/** The volume the sidecar keeps its data in, which ends with the pod. */
const kubernetesWorkerDatabaseVolume = "worker-database";

/** Refuses a database a deployment named but gave no image to run. */
export function checkedKubernetesWorkerDatabase(
  database: KubernetesWorkerDatabase | undefined,
  what: string,
): KubernetesWorkerDatabase | undefined {
  if (database !== undefined && database.image.length === 0)
    throw new RangeError(`${what} database image is empty`);
  return database;
}

/**
 * The server a worker reaches, or nothing where the site runs none: work that
 * then asks for one fails in the container rather than being placed against a
 * server this module invented an address for.
 */
export function kubernetesWorkerDatabaseVariables(
  database: KubernetesWorkerDatabase | undefined,
): readonly KubernetesContainerVariable[] {
  if (database === undefined) return [];
  return [
    {
      name: workerDatabaseUrlVariable,
      value: kubernetesWorkerDatabaseUrl,
    },
  ];
}

/**
 * The attempt's PostgreSQL, as the sidecar that runs it. The worker container
 * is not started until the startup probe has seen the server accept a
 * connection, so the worker never waits for it; and the server trusts every
 * loopback connection because it is bound to loopback alone.
 */
export function kubernetesWorkerDatabaseContainers(
  site: KubernetesPodSite,
  database: KubernetesWorkerDatabase | undefined,
): readonly KubernetesContainer[] {
  if (database === undefined) return [];
  return [
    {
      name: kubernetesWorkerDatabaseContainerName,
      image: database.image,
      args: ["-c", "listen_addresses=127.0.0.1"],
      restartPolicy: "Always",
      startupProbe: {
        exec: { command: ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"] },
        periodSeconds: 1,
        failureThreshold: 120,
      },
      env: [{ name: "POSTGRES_HOST_AUTH_METHOD", value: "trust" }],
      resources: kubernetesContainerResources(database.resources),
      securityContext: site.containerSecurityContext,
      volumeMounts: [
        {
          name: kubernetesWorkerDatabaseVolume,
          mountPath: "/var/lib/postgresql",
          readOnly: false,
        },
      ],
    },
  ];
}

/** The sidecar's data volume, bounded by the storage its own budget names. */
export function kubernetesWorkerDatabaseVolumes(
  database: KubernetesWorkerDatabase | undefined,
): KubernetesPod["spec"]["volumes"] {
  if (database === undefined) return [];
  return [
    {
      name: kubernetesWorkerDatabaseVolume,
      emptyDir: { sizeLimit: database.resources.ephemeralStorageLimit },
    },
  ];
}
