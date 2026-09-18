/**
 * Runs an adopted ticket task as an isolated Kubernetes pod and reports what it
 * produced.
 *
 * THE FABRIC CLASSIFIES ITS OWN RESULT. The domain no longer reads a verdict
 * out of a result value, nor a published commit out of an output list, so an
 * evaluator's pass or fail and a work task's accepted source are decided here,
 * against this tree's own worker contract, and travel as a report rather than
 * as a terminal the machine would decode.
 *
 * A PUBLISHING TASK MUST NAME EXACTLY ONE OUTPUT on the repository it ran
 * against; that commit becomes the source every later cycle and the
 * finalization run from, and an output list that does not say so is the
 * process failure the domain used to raise as
 * `WorkResultMissingExactGitOutput`. Findings stay inside the manifest the
 * result reference names, checked for a shape a rework cycle can cite — an
 * unidentified or repeated one reaches the next cycle as evidence nobody can
 * quote.
 */
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Ajv2020 } from "ajv/dist/2020.js";

import * as task from "../../domain/chuggernaut/task.js";
import * as evaluation from "../../domain/chuggernaut/evaluation.js";
import * as ticket from "../../domain/chuggernaut/ticket.js";
import { ticketWorkspacePut } from "../../interpreter/ticketWorkspace.ts";
import type {
  CredentialResolved,
  RepositoryBinding,
} from "../../interpreter/finalizer.ts";
import { asRepositoryId } from "../../interpreter/finalizer.ts";
import type { ProjectRepositoryBindingRead } from "../../interpreter/repositoryConfiguration.ts";
import type { TicketContentStore } from "../../interpreter/ticketCatalog.ts";
import type {
  TicketExecutionClaim,
  TicketExecutionContent,
  TicketExecutionResult,
  TicketExecutionRunner,
  TicketExecutionView,
} from "../../interpreter/ticketExecution.ts";
import { asPlacementId } from "../../interpreter/schedulerIdentity.ts";
import { execution_profile } from "../../interpreter/executionProfile.ts";
import {
  kubernetesCancelPod,
  kubernetesCreatePod,
  kubernetesEnsureSecret,
  kubernetesPlaced,
  kubernetesPodUid,
} from "./clusterReach.ts";
import {
  checkedKubernetesPodSite,
  kubernetesAnnotationPrefix,
  kubernetesAttemptDigest,
  kubernetesContainerResources,
  kubernetesCredentials,
  kubernetesPodNamePrefix,
  kubernetesPositive,
  kubernetesReservedVariables,
  type KubernetesContainer,
  type KubernetesPod,
  type KubernetesPodSite,
  type KubernetesResourceBudget,
  type KubernetesSecret,
  type KubernetesWorkloadDatabase,
} from "./kubernetesSite.ts";

export interface TicketExecutionTerminals {
  bind(claim: TicketExecutionClaim, secret: string): Promise<boolean>;
  outcome(claim: TicketExecutionClaim): Promise<unknown>;
  renew(claim: TicketExecutionClaim, leaseSecs: number): Promise<boolean>;
}

export interface TicketRepositoryCredentials {
  credential(
    repository: RepositoryBinding,
    access: TicketExecutionView["access"],
  ): Promise<CredentialResolved>;
}

export interface KubernetesTicketExecutionConfig extends KubernetesPodSite {
  readonly podNamePrefix: string;
  readonly image: string;
  readonly callbackUrl: string;
  readonly workspacePath: string;
  readonly credentialUsername: string;
  readonly resources: KubernetesResourceBudget;
  readonly podLabels: Readonly<Record<string, string>>;
  readonly podAnnotations: Readonly<Record<string, string>>;
  readonly activeDeadlineSecs: number;
  readonly timeoutSecsMax: number;
  readonly outputBytesMax: number;
  readonly outcomePollMs: number;
  readonly outcomePollsMax: number;
  readonly leaseSecs: number;
  readonly retryAfterSecs: number;
  readonly capabilities: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly database?: KubernetesWorkloadDatabase;
}

/** The container name the attempt's PostgreSQL runs under, beside the worker's. */
export const kubernetesTicketDatabaseContainerName = "postgres";

/**
 * Where the sidecar answers and what it answers as: the pod's loopback, which
 * only this pod's containers reach, and the server's own superuser with no
 * password, because there is nothing in the pod the worker is not.
 */
export const kubernetesTicketDatabaseUrl =
  "postgres://postgres@127.0.0.1:5432/postgres";

/**
 * The variable the repository's gates read their server from. The worker runs
 * `.chug/tasks/ci.sh` directly, so the address is handed to it under the name
 * the gates already use rather than one the image would have to translate.
 */
export const kubernetesTicketDatabaseUrlVariable = "CHUG_PG_URL";

/**
 * How many databases the gates may drive at once. One server of one attempt's
 * own gets the count a single container can carry; a deployment that sized the
 * sidecar for more says so in its own site environment, which is written after
 * this and therefore wins.
 */
export const kubernetesTicketDatabaseWorkersVariable = "CHUG_PG_WORKERS";

interface TicketWorkerOutcome {
  readonly type: "result" | "process_failed" | "execution_unavailable";
  readonly manifest?: unknown;
  readonly outputs?: unknown;
  readonly evidence?: unknown;
}

function ticketConfig(
  config: KubernetesTicketExecutionConfig,
): KubernetesTicketExecutionConfig {
  checkedKubernetesPodSite(config, "ticket execution");
  kubernetesPodNamePrefix(config.podNamePrefix, "ticket execution pod prefix");
  for (const [value, what] of [
    [config.activeDeadlineSecs, "active deadline"],
    [config.timeoutSecsMax, "workload timeout"],
    [config.outputBytesMax, "output bound"],
    [config.outcomePollMs, "outcome poll interval"],
    [config.outcomePollsMax, "outcome poll limit"],
    [config.leaseSecs, "claim lease"],
    [config.retryAfterSecs, "retry interval"],
  ] as const)
    kubernetesPositive(value, `ticket execution ${what}`);
  if (config.outcomePollMs >= config.leaseSecs * 1_000)
    throw new RangeError(
      "ticket outcome poll interval must be shorter than the claim lease",
    );
  if (config.image.length === 0)
    throw new RangeError("ticket worker image is empty");
  if (config.database !== undefined && config.database.image.length === 0)
    throw new RangeError("ticket worker database image is empty");
  if (config.credentialUsername.length === 0)
    throw new RangeError("ticket credential username is empty");
  kubernetesReservedVariables(
    config.environment,
    ["CHUG_TICKET_WORKER_TASK", kubernetesTicketDatabaseUrlVariable],
    "ticket worker environment",
  );
  const callback = new URL(config.callbackUrl);
  if (callback.username !== "" || callback.password !== "")
    throw new RangeError("ticket callback URL must carry no credentials");
  return config;
}

export function kubernetesTicketExecutionPodName(
  config: KubernetesTicketExecutionConfig,
  claim: TicketExecutionClaim,
): string {
  const identity = `${claim.taskKey}:${String(claim.attempt)}:${claim.recoveryEpoch}`;
  return `${config.podNamePrefix}-${kubernetesAttemptDigest(claim.partition, identity)}`;
}

function ticketRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`ticket execution ${what} must be an object`);
  return value as Record<string, unknown>;
}

function ticketRemote(
  repository: string,
  username: string,
  credential: string | undefined,
): string {
  const remote = new URL(repository);
  if (remote.protocol !== "https:")
    throw new TypeError("ticket repository must use HTTPS");
  if (remote.username !== "" || remote.password !== "")
    throw new TypeError("ticket repository URL must carry no credentials");
  if (credential !== undefined) {
    remote.username = username;
    remote.password = credential;
  }
  return remote.href;
}

function ticketEnvelope(
  config: KubernetesTicketExecutionConfig,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
  repository: string,
  bearer: string,
  providerCredentialFile: string | undefined,
): string {
  return JSON.stringify({
    taskKey: claim.taskKey,
    callbackUrl: config.callbackUrl,
    bearer,
    workspace: config.workspacePath,
    timeoutSecsMax: config.timeoutSecsMax,
    outputBytesMax: config.outputBytesMax,
    transportUrl: repository,
    ...(providerCredentialFile === undefined ? {} : { providerCredentialFile }),
    view: {
      workload: view.workload,
      inputs: view.inputs,
      resultContract: view.resultContract,
      requiredCapabilities: view.requiredCapabilities,
      context: view.context,
      repository: view.repository,
      commit: view.commit,
      access: view.access,
    },
  });
}

function ticketProviderCredential(
  view: TicketExecutionView,
): string | undefined {
  const workload = ticketRecord(view.workload, "workload");
  if (workload["runner"] === "codex") return "codex-auth";
  if (workload["runner"] === "claude") return "claude-code";
  return undefined;
}

function ticketExecutionProfile(
  view: TicketExecutionView,
): ReturnType<typeof execution_profile> | undefined {
  const workload = ticketRecord(view.workload, "workload");
  const selected = workload["execution_profile"];
  if (selected === undefined) return undefined;
  const profile = ticketRecord(selected, "execution profile");
  return execution_profile({
    required_capabilities: profile["required_capabilities"],
    runner_command: profile["runner_command"],
    cpu: profile["cpu"],
    memory_mb: profile["memory_mb"],
  });
}

function ticketResources(
  config: KubernetesTicketExecutionConfig,
  profile: ReturnType<typeof execution_profile> | undefined,
): KubernetesPod["spec"]["containers"][number]["resources"] {
  if (profile === undefined)
    return kubernetesContainerResources(config.resources);
  return kubernetesContainerResources({
    ...config.resources,
    cpuRequest: `${String(profile.cpu)}m`,
    cpuLimit: `${String(profile.cpu)}m`,
    memoryRequest: `${String(profile.memory_mb)}Mi`,
    memoryLimit: `${String(profile.memory_mb)}Mi`,
  });
}

function ticketVolumes(
  config: KubernetesTicketExecutionConfig,
  credentials: ReturnType<typeof kubernetesCredentials> & {},
): KubernetesPod["spec"]["volumes"] {
  return [
    {
      name: "workspace",
      emptyDir: { sizeLimit: config.resources.ephemeralStorageLimit },
    },
    { name: "control", emptyDir: { sizeLimit: "16Mi" } },
    ...(config.database === undefined
      ? []
      : [
          {
            name: "database",
            emptyDir: {
              sizeLimit: config.database.resources.ephemeralStorageLimit,
            },
          },
        ]),
    ...credentials.volumes,
  ];
}

/**
 * The server this attempt's gates reach, or nothing where the site runs none:
 * work that then asks for one fails in the container rather than being placed
 * against a server this module invented an address for.
 */
function ticketDatabaseVariables(
  config: KubernetesTicketExecutionConfig,
): KubernetesPod["spec"]["containers"][number]["env"] {
  if (config.database === undefined) return [];
  return [
    {
      name: kubernetesTicketDatabaseUrlVariable,
      value: kubernetesTicketDatabaseUrl,
    },
    { name: kubernetesTicketDatabaseWorkersVariable, value: "1" },
  ];
}

/**
 * The attempt's PostgreSQL, as the sidecar that runs it. The worker container
 * is not started until the startup probe has seen the server accept a
 * connection, so the worker never waits for it.
 */
function ticketDatabaseContainer(
  config: KubernetesTicketExecutionConfig,
  database: KubernetesWorkloadDatabase,
): KubernetesContainer {
  return {
    name: kubernetesTicketDatabaseContainerName,
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
    securityContext: config.containerSecurityContext,
    volumeMounts: [
      { name: "database", mountPath: "/var/lib/postgresql", readOnly: false },
    ],
  };
}

function ticketEnvironment(
  config: KubernetesTicketExecutionConfig,
  secret: string,
): KubernetesPod["spec"]["containers"][number]["env"] {
  return [
    {
      name: "CHUG_TICKET_WORKER_TASK",
      valueFrom: { secretKeyRef: { name: secret, key: "task" } },
    },
    ...ticketDatabaseVariables(config),
    ...Object.entries(config.environment).map(([name, value]) => ({
      name,
      value,
    })),
  ];
}

function ticketPod(
  config: KubernetesTicketExecutionConfig,
  claim: TicketExecutionClaim,
  credentials: ReturnType<typeof kubernetesCredentials> & {},
  view: TicketExecutionView,
): KubernetesPod {
  const name = kubernetesTicketExecutionPodName(config, claim);
  const profile = ticketExecutionProfile(view);
  const runnerCommand = profile?.runner_command[0];
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      namespace: config.namespace,
      labels: config.podLabels,
      annotations: {
        ...config.podAnnotations,
        [`${kubernetesAnnotationPrefix}tenant`]: claim.partition.tenant,
        [`${kubernetesAnnotationPrefix}project`]: claim.partition.project,
        [`${kubernetesAnnotationPrefix}task-key`]: claim.taskKey,
        [`${kubernetesAnnotationPrefix}attempt`]: String(claim.attempt),
      },
    },
    spec: {
      restartPolicy: "Never",
      serviceAccountName: config.serviceAccountName,
      automountServiceAccountToken: false,
      activeDeadlineSeconds: config.activeDeadlineSecs,
      nodeSelector: config.nodeSelector,
      securityContext: config.podSecurityContext,
      ...(config.database === undefined
        ? {}
        : {
            initContainers: [ticketDatabaseContainer(config, config.database)],
          }),
      containers: [
        {
          name: "ticket-worker",
          image: config.image,
          ...(profile === undefined || runnerCommand === undefined
            ? {}
            : {
                command: [runnerCommand],
                args: profile.runner_command.slice(1),
              }),
          env: ticketEnvironment(config, name),
          resources: ticketResources(config, profile),
          securityContext: config.containerSecurityContext,
          volumeMounts: [
            {
              name: "workspace",
              mountPath: config.workspacePath,
              readOnly: false,
            },
            {
              name: "control",
              mountPath: "/tmp",
              readOnly: false,
            },
            ...credentials.mounts,
          ],
        },
      ],
      volumes: ticketVolumes(config, credentials),
    },
  };
}

function ticketSecret(
  config: KubernetesTicketExecutionConfig,
  pod: KubernetesPod,
  podUid: string,
  envelope: string,
): KubernetesSecret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    immutable: true,
    metadata: {
      name: pod.metadata.name,
      namespace: config.namespace,
      ownerReferences: [
        {
          apiVersion: "v1",
          kind: "Pod",
          name: pod.metadata.name,
          uid: podUid,
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    stringData: { task: envelope },
  };
}

async function ticketFailure(
  content: TicketContentStore,
  claim: TicketExecutionClaim,
  evidence: string,
): Promise<task.TaskFailure> {
  return new task.TaskFailure(
    claim.obligation.task,
    await content.put("text/plain", evidence),
  );
}

async function ticketProcessFailed(
  content: TicketContentStore,
  claim: TicketExecutionClaim,
  evidence: string,
): Promise<TicketExecutionResult> {
  return {
    result: "ProcessFailed",
    failure: await ticketFailure(content, claim, evidence),
  };
}

function ticketMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Validates a worker's manifest and turns it into the report the machine takes. */
async function ticketProduced(
  content: TicketContentStore,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
  outcome: TicketWorkerOutcome,
): Promise<TicketExecutionResult> {
  let manifest: Record<string, unknown>;
  try {
    manifest = ticketRecord(outcome.manifest, "result");
    const validate = new Ajv2020({
      strict: false,
      allErrors: true,
      validateFormats: false,
    }).compile(ticketRecord(view.resultContract, "result contract"));
    if (!validate(manifest))
      throw new TypeError(
        `result contract violation: ${validate.errors?.[0]?.message ?? "invalid result"}`,
      );
  } catch (error) {
    return ticketProcessFailed(
      content,
      claim,
      ticketMessage(error, "workload result is invalid"),
    );
  }
  const resultRef = await content.put(
    "application/json",
    JSON.stringify(manifest),
  );
  try {
    return {
      result: "Produced",
      report: await ticketReport(
        content,
        claim,
        view,
        { manifest, outputs: outcome.outputs },
        resultRef,
      ),
    };
  } catch (error) {
    return ticketProcessFailed(
      content,
      claim,
      ticketMessage(error, "workload result is invalid"),
    );
  }
}

async function ticketReport(
  content: TicketContentStore,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
  produced: {
    readonly manifest: Record<string, unknown>;
    readonly outputs: unknown;
  },
  resultRef: task.ContentRef,
): Promise<ticket.WorkResultReport | ticket.EvaluationResultReport> {
  const owner = task.task_owner(claim.obligation.task);
  const result = task.ValidatedTaskResult.produce(claim.obligation, resultRef);
  return claim.obligation.task instanceof task.EvaluationTaskId
    ? new ticket.EvaluationResultReport(
        owner,
        result,
        ticketExecutionVerdict(produced.manifest),
      )
    : new ticket.WorkResultReport(
        owner,
        result,
        await ticketAcceptedSource(content, view, produced.outputs),
      );
}

/** An evaluator's manifest says pass or fail, and a passing one may hold no findings. */
export function ticketExecutionVerdict(
  manifest: Record<string, unknown>,
): evaluation.EvaluationVerdict {
  const verdict = Object.hasOwn(manifest, "verdict")
    ? manifest["verdict"]
    : "pass";
  if (!["pass", "passed", "fail", "failed"].includes(String(verdict)))
    throw new TypeError("ticket execution manifest verdict is invalid");
  const findings = ticketFindings(manifest);
  const passed = verdict === "pass" || verdict === "passed";
  if (passed && findings > 0)
    throw new TypeError("a passing evaluator manifest cannot contain findings");
  return passed
    ? new evaluation.EvaluatorPass()
    : new evaluation.EvaluatorFail();
}

/** Counts the findings a manifest declares, refusing a malformed list. */
function ticketFindings(manifest: Record<string, unknown>): number {
  const raw = manifest["findings"] ?? [];
  if (!Array.isArray(raw))
    throw new TypeError("ticket execution findings are invalid");
  const seen = new Set<number>();
  for (const [offset, entry] of raw.entries()) {
    const finding = ticketRecord(entry, "finding");
    const description = finding["description"];
    if (typeof description !== "string" || description.length === 0)
      throw new TypeError("ticket execution finding description is invalid");
    const identifier =
      typeof finding["id"] === "number" && Number.isInteger(finding["id"])
        ? finding["id"]
        : offset + 1;
    if (identifier <= 0)
      throw new TypeError("ticket execution finding identity is invalid");
    if (seen.has(identifier))
      throw new TypeError("ticket execution finding identity is repeated");
    seen.add(identifier);
  }
  return raw.length;
}

/**
 * The source the machine is to accept for a work result: a publishing task's
 * one output, or the source a non-publishing task never moved off.
 */
async function ticketAcceptedSource(
  content: TicketContentStore,
  view: TicketExecutionView,
  raw: unknown,
): Promise<task.ContentRef> {
  if (!Array.isArray(raw))
    throw new TypeError("ticket execution outputs must be an array");
  if (view.access === "ReadRepository") {
    if (raw.length !== 0)
      throw new TypeError("read-only ticket execution produced an output");
    return view.source;
  }
  if (raw.length !== 1)
    throw new TypeError("publishing ticket execution must produce one output");
  const output = ticketRecord(raw[0], "output");
  if (output["repository"] !== view.repository)
    throw new TypeError("ticket execution output repository is invalid");
  const commit = output["commit"];
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/iu.test(commit))
    throw new TypeError("ticket execution output commit is invalid");
  return ticketWorkspacePut(content, {
    repository: view.repository,
    commit: commit.toLowerCase(),
  });
}

async function ticketResult(
  content: TicketContentStore,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
  raw: unknown,
): Promise<TicketExecutionResult> {
  let outcome: TicketWorkerOutcome;
  try {
    outcome = ticketRecord(
      raw,
      "worker outcome",
    ) as unknown as TicketWorkerOutcome;
  } catch (error) {
    return ticketProcessFailed(
      content,
      claim,
      ticketMessage(error, "worker outcome is invalid"),
    );
  }
  if (outcome.type === "result")
    return ticketProduced(content, claim, view, outcome);
  const evidence =
    typeof outcome.evidence === "string"
      ? outcome.evidence
      : "ticket worker returned an invalid outcome";
  if (outcome.type === "execution_unavailable")
    return {
      result: "ExecutionUnavailable",
      evidence: await content.put("text/plain", evidence),
    };
  return ticketProcessFailed(content, claim, evidence);
}

interface TicketRunnerState {
  readonly content: TicketExecutionContent;
  readonly terminals: TicketExecutionTerminals;
  readonly bindings: ProjectRepositoryBindingRead;
  readonly credentials: TicketRepositoryCredentials;
  readonly config: KubernetesTicketExecutionConfig;
  readonly fetcher: typeof fetch;
  readonly mint: () => string;
}

async function ticketUnavailable(
  state: TicketRunnerState,
  claim: TicketExecutionClaim,
  evidence: string,
): Promise<TicketExecutionResult> {
  return {
    result: "ExecutionUnavailable",
    evidence: await state.content(claim.partition).put("text/plain", evidence),
  };
}

async function ticketRetry(
  state: TicketRunnerState,
  claim: TicketExecutionClaim,
  evidence: string,
): Promise<TicketExecutionResult> {
  return {
    result: "Retry",
    retryAfterSecs: state.config.retryAfterSecs,
    evidence: await state.content(claim.partition).put("text/plain", evidence),
  };
}

async function ticketRepository(
  state: TicketRunnerState,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
): Promise<string | TicketExecutionResult> {
  const binding = await state.bindings.binding(
    claim.partition,
    asRepositoryId(view.repository),
  );
  if (binding === undefined)
    return ticketUnavailable(
      state,
      claim,
      "repository is not bound to the project",
    );
  const resolved = await state.credentials.credential(binding, view.access);
  if (resolved.resolved === "Unavailable")
    return ticketRetry(state, claim, "repository credential is unavailable");
  if (resolved.resolved === "Denied")
    return ticketUnavailable(state, claim, "repository credential was denied");
  try {
    return ticketRemote(
      binding.repository,
      state.config.credentialUsername,
      resolved.credential,
    );
  } catch (error) {
    return ticketUnavailable(
      state,
      claim,
      error instanceof Error ? error.message : "repository binding is invalid",
    );
  }
}

async function ticketPoll(
  state: TicketRunnerState,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
  pod: KubernetesPod,
): Promise<TicketExecutionResult> {
  for (let poll = 0; poll < state.config.outcomePollsMax; poll += 1) {
    const outcome = await state.terminals.outcome(claim);
    if (outcome !== undefined) {
      await kubernetesCancelPod(state.config, state.fetcher, pod.metadata.name);
      return ticketResult(state.content(claim.partition), claim, view, outcome);
    }
    if (!(await state.terminals.renew(claim, state.config.leaseSecs))) {
      await kubernetesCancelPod(state.config, state.fetcher, pod.metadata.name);
      return ticketRetry(state, claim, "ticket execution claim was fenced");
    }
    if (poll + 1 < state.config.outcomePollsMax)
      await delay(state.config.outcomePollMs);
  }
  await kubernetesCancelPod(state.config, state.fetcher, pod.metadata.name);
  return ticketRetry(
    state,
    claim,
    "ticket worker outcome exceeded its operational bound",
  );
}

async function ticketLaunch(
  state: TicketRunnerState,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
  repository: string,
  bearer: string,
): Promise<TicketExecutionResult> {
  const providerCredential = ticketProviderCredential(view);
  const credentials = kubernetesCredentials(
    state.config,
    {
      tools: [],
      credentials: providerCredential === undefined ? [] : [providerCredential],
      network:
        ticketRecord(view.workload, "workload")["network_access"] === true,
      filesystem: "WriteWorkspace",
      mayCompleteTask: true,
    },
    "ticket-worker",
  );
  if (credentials === undefined)
    return ticketUnavailable(
      state,
      claim,
      "ticket worker provider credential is unavailable",
    );
  const pod = ticketPod(state.config, claim, credentials, view);
  await kubernetesCancelPod(state.config, state.fetcher, pod.metadata.name);
  const created = await kubernetesCreatePod(state.config, state.fetcher, pod);
  const placed = kubernetesPlaced(
    state.config,
    created,
    asPlacementId(pod.metadata.name),
  );
  const uid = kubernetesPodUid(created, pod);
  if (placed.placed !== "Placed" || uid === undefined)
    return ticketRetry(state, claim, "ticket worker pod is unavailable");
  const secret = await kubernetesEnsureSecret(
    state.config,
    state.fetcher,
    ticketSecret(
      state.config,
      pod,
      uid,
      ticketEnvelope(
        state.config,
        claim,
        view,
        repository,
        bearer,
        providerCredential === undefined
          ? undefined
          : credentials.files[providerCredential],
      ),
    ),
  );
  if (
    secret.reached !== "Status" ||
    (secret.status !== 200 && secret.status !== 201)
  ) {
    await kubernetesCancelPod(state.config, state.fetcher, pod.metadata.name);
    return ticketRetry(state, claim, "ticket worker Secret is unavailable");
  }
  return ticketPoll(state, claim, view, pod);
}

async function ticketRun(
  state: TicketRunnerState,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
): Promise<TicketExecutionResult> {
  const workload = ticketRecord(view.workload, "workload");
  if (workload["cloud_identity"] !== undefined)
    return ticketUnavailable(
      state,
      claim,
      "cloud identity delivery is unavailable for adopted ticket workers",
    );
  if (
    view.requiredCapabilities.some(
      (capability) => !state.config.capabilities.includes(capability),
    )
  )
    return ticketUnavailable(
      state,
      claim,
      "required execution capability is unavailable",
    );
  const repository = await ticketRepository(state, claim, view);
  if (typeof repository !== "string") return repository;
  const bearer = state.mint();
  if (!(await state.terminals.bind(claim, bearer)))
    return ticketRetry(state, claim, "ticket execution claim was fenced");
  return ticketLaunch(state, claim, view, repository, bearer);
}

export function kubernetesTicketExecutionRunner(
  content: TicketExecutionContent,
  terminals: TicketExecutionTerminals,
  bindings: ProjectRepositoryBindingRead,
  credentials: TicketRepositoryCredentials,
  input: KubernetesTicketExecutionConfig,
  fetcher: typeof fetch = fetch,
  mint: () => string = () => randomBytes(32).toString("base64url"),
): TicketExecutionRunner {
  const state: TicketRunnerState = {
    content,
    terminals,
    bindings,
    credentials,
    config: ticketConfig(input),
    fetcher,
    mint,
  };
  return {
    run: (claim, view) => ticketRun(state, claim, view),
    cancel: (claim) =>
      kubernetesCancelPod(
        state.config,
        state.fetcher,
        kubernetesTicketExecutionPodName(state.config, claim),
      ).then(() => undefined),
  };
}
