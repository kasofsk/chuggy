/**
 * The thin client over `fetch` against the API server: one namespace, the
 * Jobs the fabric runs and the Secrets it writes beside them, a watch — and
 * not the client library, whose informer
 * machinery this adapter replaces with a list-and-reconnect loop it can read.
 * Refutation trigger: a second watch-resync defect adopts the library, and the
 * dependency's justification writes itself.
 *
 * ONE CLIENT, CONFIGURED TWO WAYS. In-cluster the base is the API server over
 * TLS and `bearerTokenPath` names the mounted service-account token, re-read
 * per call because the platform rotates it; the cluster's CA reaches the TLS
 * stack through Node's own `NODE_EXTRA_CA_CERTS`, which is the deployment's
 * knob rather than this file's. A suite hands a plain http base and no token
 * path, through the same code.
 *
 * THE WATCH IS THE CHUNKED-LINES PROTOCOL: one JSON event per line for as long
 * as the server holds the stream. A stream that ends is a drop the caller
 * reconnects from; an ERROR event or response carrying the gone status is an
 * expired resourceVersion, answered as its own end so the caller relists
 * rather than resumes. Anything else escaping here is infrastructure for the
 * caller's ladder.
 */

import { readFileSync } from "node:fs";

import * as z from "zod";

import type { CatalogResources } from "./catalog.ts";

/** Where and as whom the client calls: the API base, the one namespace, and the optional token file. */
export interface FabricApiOptions {
  readonly base: string;
  readonly namespace: string;
  readonly bearerTokenPath?: string | undefined;
}

/** One environment entry as the API takes it: a literal value, or a key read out of a named Secret. */
export type FabricApiJobEnv =
  | { readonly name: string; readonly value: string }
  | {
      readonly name: string;
      readonly valueFrom: {
        readonly secretKeyRef: {
          readonly name: string;
          readonly key: string;
        };
      };
    };

/** The one container a spawned Job runs. */
export interface FabricApiContainer {
  readonly name: string;
  readonly image: string;
  readonly command: readonly string[];
  readonly env: readonly FabricApiJobEnv[];
  readonly resources: CatalogResources;
}

/** The Job this adapter writes: name-keyed absorption, the axiom bounds, and one never-restarting pod template. */
export interface FabricApiJob {
  readonly apiVersion: "batch/v1";
  readonly kind: "Job";
  readonly metadata: {
    readonly name: string;
    readonly labels: Readonly<Record<string, string>>;
  };
  readonly spec: {
    readonly activeDeadlineSeconds: number;
    readonly backoffLimit: number;
    readonly template: {
      readonly metadata: { readonly labels: Readonly<Record<string, string>> };
      readonly spec: {
        readonly restartPolicy: "Never";
        readonly containers: readonly [FabricApiContainer];
      };
    };
  };
}

/** How a Job create resolved: made, with the uid an owning Secret needs, or absorbed by the name. */
export type FabricApiCreated =
  | { readonly created: "Created"; readonly uid: string }
  | { readonly created: "AlreadyExists" };

/** The one owner a per-job Secret names: the Job instance whose collection collects the material. */
export interface FabricApiOwner {
  readonly apiVersion: "batch/v1";
  readonly kind: "Job";
  readonly name: string;
  readonly uid: string;
}

/** The Secret this adapter writes beside a Job: name-keyed absorption, owned by the Job, material under `stringData` so the server owns the encoding. */
export interface FabricApiSecret {
  readonly apiVersion: "v1";
  readonly kind: "Secret";
  readonly metadata: {
    readonly name: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly ownerReferences: readonly [FabricApiOwner];
  };
  readonly type: "Opaque";
  readonly stringData: Readonly<Record<string, string>>;
}

/** One status condition as read back, untranslated. */
export interface FabricApiCondition {
  readonly type: string;
  readonly status: string;
}

/** What this adapter reads off a Job the API hands back: the name, the labels, and how it stands. */
export interface FabricApiJobView {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly conditions: readonly FabricApiCondition[];
}

/** One list: the version the watch resumes from, and every matching Job as a view. */
export interface FabricApiJobList {
  readonly resourceVersion: string;
  readonly jobs: readonly FabricApiJobView[];
}

/** How a watch stream ended: dropped by the server, or expired past relisting. */
export type FabricApiWatchEnd = "Dropped" | "Expired";

/** The HTTP status the API answers an expired resourceVersion with. */
const fabricApiGoneStatus = 410;

/** The most held bytes a watch may buffer awaiting a newline. */
const fabricApiLineBytesMax = 1_048_576;

const fabricApiJobRawSchema = z.object({
  metadata: z.object({
    name: z.string(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  status: z
    .object({
      conditions: z
        .array(z.object({ type: z.string(), status: z.string() }))
        .optional(),
    })
    .optional(),
});

const fabricApiListSchema = z.object({
  metadata: z.object({ resourceVersion: z.string() }),
  items: z.array(fabricApiJobRawSchema),
});

const fabricApiEventSchema = z.object({
  type: z.string(),
  object: z.unknown(),
});

const fabricApiErrorSchema = z.object({ code: z.number().optional() });

const fabricApiUidSchema = z.object({
  metadata: z.object({ uid: z.string() }),
});

/** Flattens one raw Job into the view, absent halves read as empty. */
function fabricApiViewOf(
  raw: z.infer<typeof fabricApiJobRawSchema>,
): FabricApiJobView {
  return {
    name: raw.metadata.name,
    labels: raw.metadata.labels ?? {},
    conditions: raw.status?.conditions ?? [],
  };
}

/** The one collection URL every call addresses, with its query. */
function fabricApiUrl(
  options: FabricApiOptions,
  query: Readonly<Record<string, string>>,
): string {
  const url = new URL(
    `${options.base}/apis/batch/v1/namespaces/${options.namespace}/jobs`,
  );
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

/** The credential headers, re-read per call because the platform rotates the mounted token. */
function fabricApiHeaders(
  options: FabricApiOptions,
): Readonly<Record<string, string>> {
  if (options.bearerTokenPath === undefined) return {};
  const token = readFileSync(options.bearerTokenPath, "utf8").trim();
  return { authorization: `Bearer ${token}` };
}

/** Posts one object to a collection; a name collision is the absorption the naming buys, answered as a value. */
async function fabricApiPost(
  options: FabricApiOptions,
  url: string,
  payload: unknown,
  named: string,
): Promise<{ readonly absorbed: boolean; readonly body: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...fabricApiHeaders(options),
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (response.status === 409) return { absorbed: true, body };
  if (!response.ok) {
    throw new Error(
      `k8sFabric: creating ${named} answered ${String(response.status)} — ${body}`,
    );
  }
  return { absorbed: false, body };
}

/** The uid off an object the API answered, which is what ties an ownerReference to exactly this instance. */
function fabricApiUidOf(body: string, named: string): string {
  const parsed = fabricApiUidSchema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    throw new Error(`k8sFabric: the API answered no uid for ${named}`);
  }
  return parsed.data.metadata.uid;
}

/** Posts one Job, answering the created instance's uid; a name collision is absorbed as a value. */
export async function fabricApiCreateJob(
  options: FabricApiOptions,
  job: FabricApiJob,
): Promise<FabricApiCreated> {
  const posted = await fabricApiPost(
    options,
    fabricApiUrl(options, {}),
    job,
    job.metadata.name,
  );
  if (posted.absorbed) return { created: "AlreadyExists" };
  return {
    created: "Created",
    uid: fabricApiUidOf(posted.body, job.metadata.name),
  };
}

/** One Job's uid read back by name, for the absorbed create that still needs to own a Secret. */
export async function fabricApiReadJobUid(
  options: FabricApiOptions,
  name: string,
): Promise<string> {
  const response = await fetch(`${fabricApiUrl(options, {})}/${name}`, {
    headers: fabricApiHeaders(options),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `k8sFabric: reading ${name} answered ${String(response.status)}`,
    );
  }
  return fabricApiUidOf(body, name);
}

/** Posts one Secret to the core-group collection, absorbing a name collision exactly as a Job's is. */
export async function fabricApiCreateSecret(
  options: FabricApiOptions,
  secret: FabricApiSecret,
): Promise<"Created" | "AlreadyExists"> {
  const posted = await fabricApiPost(
    options,
    `${options.base}/api/v1/namespaces/${options.namespace}/secrets`,
    secret,
    `secret ${secret.metadata.name}`,
  );
  return posted.absorbed ? "AlreadyExists" : "Created";
}

/** Lists every matching Job, with the resourceVersion a watch resumes from. */
export async function fabricApiListJobs(
  options: FabricApiOptions,
  labelSelector: string,
  signal?: AbortSignal,
): Promise<FabricApiJobList> {
  const response = await fetch(fabricApiUrl(options, { labelSelector }), {
    headers: fabricApiHeaders(options),
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw new Error(
      `k8sFabric: listing jobs answered ${String(response.status)}`,
    );
  }
  const parsed = fabricApiListSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("k8sFabric: the job list is not a shape this client reads");
  }
  return {
    resourceVersion: parsed.data.metadata.resourceVersion,
    jobs: parsed.data.items.map(fabricApiViewOf),
  };
}

/** Streams the watch's lines, releasing the stream on every exit; the bound judges only the residual awaiting its newline, so a server that stops framing cannot grow it without end. */
async function fabricApiWatchLines(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => Promise<FabricApiWatchEnd | undefined>,
): Promise<FabricApiWatchEnd> {
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    let held = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return "Dropped";
      held += decoder.decode(value, { stream: true });
      for (;;) {
        const at = held.indexOf("\n");
        if (at < 0) break;
        const line = held.slice(0, at).trim();
        held = held.slice(at + 1);
        if (line === "") continue;
        const ended = await onLine(line);
        if (ended !== undefined) return ended;
      }
      if (held.length > fabricApiLineBytesMax) {
        throw new Error("k8sFabric: a watch line outgrew the held-bytes bound");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Reads one watch event: a Job goes to the handler, the gone status ends the stream, the rest is ignored. */
async function fabricApiWatchEvent(
  line: string,
  onJob: (job: FabricApiJobView) => Promise<void>,
): Promise<FabricApiWatchEnd | undefined> {
  const event = fabricApiEventSchema.safeParse(JSON.parse(line));
  if (!event.success) {
    throw new Error(
      "k8sFabric: a watch line is not an event this client reads",
    );
  }
  if (event.data.type === "ERROR") {
    const status = fabricApiErrorSchema.safeParse(event.data.object);
    if (status.success && status.data.code === fabricApiGoneStatus) {
      return "Expired";
    }
    throw new Error(`k8sFabric: the watch answered an error event — ${line}`);
  }
  if (event.data.type !== "ADDED" && event.data.type !== "MODIFIED") {
    return undefined;
  }
  const job = fabricApiJobRawSchema.safeParse(event.data.object);
  if (!job.success) {
    throw new Error(
      "k8sFabric: a watch event carries no Job this client reads",
    );
  }
  await onJob(fabricApiViewOf(job.data));
  return undefined;
}

/** Watches matching Jobs from the given resourceVersion until the stream ends, one handler call per Job event. */
export async function fabricApiWatchJobs(
  options: FabricApiOptions,
  labelSelector: string,
  resourceVersion: string,
  onJob: (job: FabricApiJobView) => Promise<void>,
  signal?: AbortSignal,
): Promise<FabricApiWatchEnd> {
  const response = await fetch(
    fabricApiUrl(options, { watch: "1", labelSelector, resourceVersion }),
    { headers: fabricApiHeaders(options), signal: signal ?? null },
  );
  if (response.status === fabricApiGoneStatus) return "Expired";
  if (!response.ok || response.body === null) {
    throw new Error(
      `k8sFabric: the watch answered ${String(response.status)} and no stream`,
    );
  }
  return fabricApiWatchLines(response.body, (line) =>
    fabricApiWatchEvent(line, onJob),
  );
}

/** Deletes every matching Job and what it spawned; nothing matching, or nothing there, is already the asked-for state. */
export async function fabricApiDeleteJobsByLabel(
  options: FabricApiOptions,
  labelSelector: string,
): Promise<void> {
  const response = await fetch(
    fabricApiUrl(options, { labelSelector, propagationPolicy: "Foreground" }),
    { method: "DELETE", headers: fabricApiHeaders(options) },
  );
  await response.text();
  if (response.status === 404) return;
  if (!response.ok) {
    throw new Error(
      `k8sFabric: deleting by ${labelSelector} answered ${String(response.status)}`,
    );
  }
}
