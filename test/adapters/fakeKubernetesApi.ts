/**
 * The Jobs API as a fixture: a `node:http` server implementing exactly what
 * the thin client uses — create with a conflict on a duplicate name, list,
 * the chunked-lines watch stream, and delete by label — plus the scripting a
 * case needs to inject a drop, an expired watch, or a failing delete. It is a
 * fixture, not a simulation: nothing here transitions a Job on its own, and
 * every phase change is an event the case sends itself.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import type { FabricApiJob } from "../../src/adapters/k8sFabric/client.ts";

/** A stored Job as a case shapes it: what the client wrote, plus any status the case gave it. */
export interface FakeStoredJob extends FabricApiJob {
  readonly status?: {
    readonly conditions?: readonly { type: string; status: string }[];
  };
}

/** One watch event as the protocol frames it. */
export interface FakeWatchEvent {
  readonly type: string;
  readonly object: unknown;
}

/** The fixture's face: the base URL, the recorded traffic, and the scripting hooks. */
export interface FakeKubernetesApi {
  readonly base: string;
  readonly log: readonly string[];
  readonly authorizations: readonly (string | undefined)[];
  readonly created: readonly FabricApiJob[];
  readonly deletes: readonly {
    readonly selector: string | null;
    readonly propagationPolicy: string | null;
  }[];
  jobs(): readonly FakeStoredJob[];
  putJob(job: FakeStoredJob): void;
  clearJobs(): void;
  send(event: FakeWatchEvent): void;
  dropWatches(): void;
  expireWatches(): void;
  failNextDelete(status: number): void;
  close(): Promise<void>;
}

interface FakeState {
  readonly server: Server;
  readonly jobs: Map<string, FakeStoredJob>;
  readonly log: string[];
  readonly authorizations: (string | undefined)[];
  readonly created: FabricApiJob[];
  readonly deletes: {
    selector: string | null;
    propagationPolicy: string | null;
  }[];
  readonly watches: Set<ServerResponse>;
  resourceVersion: number;
  deleteFailure: number | undefined;
}

/** Whether a job's labels match a selector: bare key is existence, `key=value` is equality. */
function fakeMatches(job: FakeStoredJob, selector: string | null): boolean {
  if (selector === null || selector === "") return true;
  const at = selector.indexOf("=");
  const labels = job.metadata.labels;
  if (at < 0) return Object.hasOwn(labels, selector);
  return labels[selector.slice(0, at)] === selector.slice(at + 1);
}

function fakeBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function fakeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function fakeCreate(
  own: FakeState,
  response: ServerResponse,
  body: string,
): void {
  const job = JSON.parse(body) as FabricApiJob;
  if (own.jobs.has(job.metadata.name)) {
    fakeJson(response, 409, {
      kind: "Status",
      reason: "AlreadyExists",
      code: 409,
    });
    return;
  }
  own.jobs.set(job.metadata.name, job);
  own.created.push(job);
  own.resourceVersion += 1;
  fakeJson(response, 201, job);
}

function fakeList(
  own: FakeState,
  response: ServerResponse,
  selector: string | null,
): void {
  fakeJson(response, 200, {
    kind: "JobList",
    metadata: { resourceVersion: String(own.resourceVersion) },
    items: [...own.jobs.values()].filter((job) => fakeMatches(job, selector)),
  });
}

function fakeWatch(own: FakeState, response: ServerResponse): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.flushHeaders();
  own.watches.add(response);
  response.on("close", () => own.watches.delete(response));
}

function fakeDelete(
  own: FakeState,
  response: ServerResponse,
  selector: string | null,
  propagationPolicy: string | null,
): void {
  own.deletes.push({ selector, propagationPolicy });
  if (own.deleteFailure !== undefined) {
    const status = own.deleteFailure;
    own.deleteFailure = undefined;
    fakeJson(response, status, { kind: "Status", code: status });
    return;
  }
  for (const [name, job] of own.jobs) {
    if (fakeMatches(job, selector)) own.jobs.delete(name);
  }
  own.resourceVersion += 1;
  fakeJson(response, 200, { kind: "Status", status: "Success" });
}

async function fakeHandle(
  own: FakeState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://fake.invalid");
  own.log.push(`${request.method ?? ""} ${url.pathname}${url.search}`);
  own.authorizations.push(request.headers.authorization);
  const selector = url.searchParams.get("labelSelector");
  if (request.method === "POST") {
    fakeCreate(own, response, await fakeBody(request));
    return;
  }
  if (request.method === "DELETE") {
    fakeDelete(
      own,
      response,
      selector,
      url.searchParams.get("propagationPolicy"),
    );
    return;
  }
  if (url.searchParams.get("watch") === "1") {
    fakeWatch(own, response);
    return;
  }
  fakeList(own, response, selector);
}

/** A listening fixture on an ephemeral local port. */
export function fakeKubernetesApi(): Promise<FakeKubernetesApi> {
  const own: FakeState = {
    server: createServer(),
    jobs: new Map(),
    log: [],
    authorizations: [],
    created: [],
    deletes: [],
    watches: new Set(),
    resourceVersion: 1,
    deleteFailure: undefined,
  };
  own.server.on("request", (request, response) => {
    void fakeHandle(own, request, response);
  });
  return new Promise((resolve) => {
    own.server.listen(0, "127.0.0.1", () => {
      const address = own.server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${String(address.port)}`,
        log: own.log,
        authorizations: own.authorizations,
        created: own.created,
        deletes: own.deletes,
        jobs: () => [...own.jobs.values()],
        putJob: (job) => {
          own.jobs.set(job.metadata.name, job);
          own.resourceVersion += 1;
        },
        clearJobs: () => {
          own.jobs.clear();
          own.resourceVersion += 1;
        },
        send: (event) => {
          for (const watch of own.watches) {
            watch.write(`${JSON.stringify(event)}\n`);
          }
        },
        dropWatches: () => {
          for (const watch of own.watches) watch.end();
          own.watches.clear();
        },
        expireWatches: () => {
          for (const watch of own.watches) {
            watch.write(
              `${JSON.stringify({ type: "ERROR", object: { kind: "Status", code: 410 } })}\n`,
            );
            watch.end();
          }
          own.watches.clear();
        },
        failNextDelete: (status) => {
          own.deleteFailure = status;
        },
        close: () =>
          new Promise((closed) => {
            for (const watch of own.watches) watch.destroy();
            own.server.closeAllConnections();
            own.server.close(() => closed());
          }),
      });
    });
  });
}
