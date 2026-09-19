/**
 * The Nomad backend against a recorded agent: what one assignment becomes, what
 * this pool reads back as its own, and which answers are a denial rather than
 * an outage.
 *
 * NOTHING HERE REACHES AN AGENT. Every case answers the fetch itself, because
 * what is under test is the document this backend submits and the reading it
 * makes of an answer, neither of which a live scheduler would tell us more
 * about.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { WorkerPoolAssignment } from "../../src/contract/workerPool.ts";
import {
  nomadPoolBackend,
  nomadPoolCredentialPath,
  nomadPoolJobName,
  nomadPoolTaskVariable,
  type NomadPoolPlacementConfig,
} from "../../src/adapters/nomad/poolPlacement.ts";

const root = mkdtempSync(join(tmpdir(), "chuggy-pool-nomad-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});
const credentialFile = join(root, "provider.json");
writeFileSync(credentialFile, '{"token":"provider"}');

const config: NomadPoolPlacementConfig = {
  apiBaseUrl: "http://agent.invalid:4646",
  requestTimeoutSecsMax: 2,
  unavailableRetryAfterSecs: 11,
  heldJobsMax: 8,
  jobNamePrefix: "chuggy-pool",
  datacenters: ["dc1"],
  capabilityMetaKey: "chug.capabilities",
  capabilities: { linux: "linux" },
  megahertzPerCore: 2_500,
  source: {
    sourceUrl: "https://releases.invalid/chuggy.tar.gz",
    sourceSha256: "a".repeat(64),
    release: "b".repeat(40),
    rootPath: "/opt/chuggy",
    nodePath: "/etc/chuggy/node",
    shellPath: "/bin/sh",
    installWaitSecsMax: 600,
  },
  workspacePath: "/workspace",
  timeoutSecsMax: 3_600,
  outputBytesMax: 4_096,
  environment: { POOL_SITE: "configured" },
  providerCredentialSource: credentialFile,
};

const assignment: WorkerPoolAssignment = {
  assignment: "assignment-one",
  capabilities: ["linux", "unmapped"],
  cpuMillis: 2_000,
  memoryMib: 2_048,
  deadlineSecs: 900,
  callbackUrl: "https://worker-plane.invalid/v1/ticket-execution",
  bearer: "attempt-bearer",
};

/** One request the agent is sent, recorded rather than made. */
interface Reached {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function agent(answers: (reached: Reached) => Response): {
  readonly reached: Reached[];
  readonly fetcher: typeof fetch;
} {
  const reached: Reached[] = [];
  return {
    reached,
    fetcher: (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const made: Reached = {
        method: init?.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
      };
      reached.push(made);
      return Promise.resolve(answers(made));
    },
  };
}

/** An agent holding nothing, which answers the existence check and takes the job. */
function empty(): ReturnType<typeof agent> {
  return agent((made) =>
    made.method === "GET"
      ? new Response("{}", { status: 404 })
      : new Response(JSON.stringify({ EvalID: "evaluation" }), { status: 200 }),
  );
}

/** The task document one recorded registration carried. */
function task(reached: readonly Reached[]): {
  Env: Record<string, string>;
  Config: { command: string; args: readonly string[] };
  Resources: { CPU: number; MemoryMB: number };
  Templates: readonly { DestPath: string; Perms: string }[];
} {
  const submitted = reached.find((made) => made.method === "POST")?.body as {
    Job: {
      TaskGroups: readonly {
        Tasks: readonly {
          Env: Record<string, string>;
          Config: { command: string; args: readonly string[] };
          Resources: { CPU: number; MemoryMB: number };
          Templates: readonly { DestPath: string; Perms: string }[];
        }[];
      }[];
    };
  };
  const found = submitted.Job.TaskGroups[0]?.Tasks[0];
  assert.ok(found);
  return found;
}

test("a placed job is named for its assignment and asks for the box it was offered", async () => {
  const { reached, fetcher } = empty();
  assert.deepEqual(await nomadPoolBackend(config, fetcher).place(assignment), {
    placed: "Placed",
  });
  const submitted = reached.find((made) => made.method === "POST")?.body as {
    Job: {
      ID: string;
      Type: string;
      Meta: Record<string, string>;
      Constraints: readonly { LTarget: string; RTarget: string }[];
    };
  };
  assert.equal(submitted.Job.ID, nomadPoolJobName(config, "assignment-one"));
  assert.equal(submitted.Job.Type, "batch");
  assert.equal(submitted.Job.Meta["chug_assignment"], "assignment-one");
  assert.deepEqual(submitted.Job.Constraints, [
    {
      LTarget: "${meta.chug.capabilities}",
      Operand: "set_contains",
      RTarget: "linux",
    },
  ]);
  assert.equal(task(reached).Resources.CPU, 5_000);
  assert.equal(task(reached).Resources.MemoryMB, 2_048);
});

test("the envelope carries the callback and the bearer and no material at all", async () => {
  const { reached, fetcher } = empty();
  await nomadPoolBackend(config, fetcher).place(assignment);
  assert.deepEqual(JSON.parse(task(reached).Env[nomadPoolTaskVariable] ?? ""), {
    callbackUrl: assignment.callbackUrl,
    bearer: assignment.bearer,
    workspace: "/workspace",
    timeoutSecsMax: 900,
    outputBytesMax: 4_096,
    providerCredentialFile: nomadPoolCredentialPath,
  });
  assert.equal(task(reached).Env["POOL_SITE"], "configured");
});

test("the pool's own credential is rendered into the workload's private directory", async () => {
  const { reached, fetcher } = empty();
  await nomadPoolBackend(config, fetcher).place(assignment);
  assert.deepEqual(
    task(reached).Templates.map((held) => [held.DestPath, held.Perms]),
    [["secrets/provider-credential", "0600"]],
  );
});

test("a credential this pool cannot read is backpressure and not a denial", async () => {
  const { fetcher } = empty();
  assert.deepEqual(
    await nomadPoolBackend(
      { ...config, providerCredentialSource: join(root, "absent") },
      fetcher,
    ).place(assignment),
    { placed: "Unavailable", retryAfterSecs: 11 },
  );
});

test("the workload's command pins its harness by digest and self-checks before exec", async () => {
  const { reached, fetcher } = empty();
  await nomadPoolBackend(config, fetcher).place(assignment);
  const command = task(reached).Config;
  assert.equal(command.command, "/bin/sh");
  const script = command.args[1] ?? "";
  assert.match(script, /https:\/\/releases\.invalid\/chuggy\.tar\.gz/u);
  assert.match(script, new RegExp("a".repeat(64), "u"));
  assert.match(script, /--self-check/u);
  assert.ok(
    script.indexOf("--self-check") < script.lastIndexOf("exec "),
    "the self-check precedes the exec",
  );
});

test("a job the agent already holds is placed rather than registered again", async () => {
  const { reached, fetcher } = agent(
    () => new Response(JSON.stringify({ ID: "held" }), { status: 200 }),
  );
  assert.deepEqual(await nomadPoolBackend(config, fetcher).place(assignment), {
    placed: "Placed",
  });
  assert.equal(reached.filter((made) => made.method === "POST").length, 0);
});

test("an agent that refused the document itself is a settled no", async () => {
  const { fetcher } = agent((made) =>
    made.method === "GET"
      ? new Response("{}", { status: 404 })
      : new Response("invalid job", { status: 400 }),
  );
  const placement = await nomadPoolBackend(config, fetcher).place(assignment);
  assert.equal(placement.placed, "Refused");
});

test("an agent that could not be reached is backpressure with the site's own interval", async () => {
  const placement = await nomadPoolBackend(config, () =>
    Promise.reject(new Error("connection refused")),
  ).place(assignment);
  assert.deepEqual(placement, { placed: "Unavailable", retryAfterSecs: 11 });
});

/** The listing and the two jobs a recovery case reads back out of the agent. */
function running(): ReturnType<typeof agent> {
  const live = nomadPoolJobName(config, "one");
  const dead = nomadPoolJobName(config, "two");
  return agent((made) => {
    if (made.path.startsWith("/v1/jobs"))
      return new Response(JSON.stringify([{ ID: live }, { ID: dead }]), {
        status: 200,
      });
    return new Response(
      JSON.stringify({
        ID: made.path.includes(live) ? live : dead,
        Status: made.path.includes(live) ? "running" : "dead",
        Meta: { chug_assignment: made.path.includes(live) ? "one" : "two" },
      }),
      { status: 200 },
    );
  });
}

test("what the pool holds is read back out of the agent, a finished job holding nothing", async () => {
  const { reached, fetcher } = running();
  assert.deepEqual(await nomadPoolBackend(config, fetcher).held(), ["one"]);
  assert.match(reached[0]?.path ?? "", /prefix=chuggy-pool-/u);
});

test("an agent that could not be listed raises rather than reporting an empty pool", async () => {
  const { fetcher } = agent(() => new Response("{}", { status: 500 }));
  await assert.rejects(nomadPoolBackend(config, fetcher).held(), /listed/u);
});

test("stopping takes the job out of the agent, and a job already gone is the same answer", async () => {
  const { reached, fetcher } = agent(() => new Response("", { status: 404 }));
  await nomadPoolBackend(config, fetcher).stop("assignment-one");
  assert.equal(reached[0]?.method, "DELETE");
  assert.match(reached[0]?.path ?? "", /purge=true/u);
});

test("a stop the agent would not take raises rather than passing for done", async () => {
  const { fetcher } = agent(() => new Response("", { status: 500 }));
  await assert.rejects(
    nomadPoolBackend(config, fetcher).stop("assignment-one"),
    /still placed/u,
  );
});

test("a site that could not pin its harness is refused before a pool polls", () => {
  for (const source of [
    { ...config.source, sourceUrl: "http://releases.invalid/chuggy.tar.gz" },
    { ...config.source, sourceSha256: "short" },
    { ...config.source, release: "not-a-commit" },
    { ...config.source, nodePath: "node" },
  ])
    assert.throws(() => nomadPoolBackend({ ...config, source }), RangeError);
});
