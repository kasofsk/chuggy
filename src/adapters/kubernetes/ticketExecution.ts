import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Ajv2020 } from "ajv/dist/2020.js";

import * as task from "../../domain/chuggernaut/task.js";
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
  type KubernetesPod,
  type KubernetesPodSite,
  type KubernetesResourceBudget,
  type KubernetesSecret,
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
}

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
  if (config.credentialUsername.length === 0)
    throw new RangeError("ticket credential username is empty");
  kubernetesReservedVariables(
    config.environment,
    ["CHUG_TICKET_WORKER_TASK"],
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
    ...credentials.volumes,
  ];
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
): Promise<task.TaskProcessFailed> {
  return new task.TaskProcessFailed(
    new task.TaskFailure(
      claim.obligation.task,
      await content.put("text/plain", evidence),
    ),
  );
}

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
    return {
      result: "ProcessFailed",
      terminal: await ticketFailure(
        content,
        claim,
        error instanceof Error ? error.message : "workload result is invalid",
      ),
    };
  }
  const manifestReference = await content.put(
    "application/json",
    JSON.stringify(manifest),
  );
  let decoded: {
    readonly value: number;
    readonly findings: readonly task.ResultFinding[];
  };
  try {
    decoded = await ticketExecutionVerdict(content, claim, manifest);
  } catch (error) {
    return {
      result: "ProcessFailed",
      terminal: await ticketFailure(
        content,
        claim,
        error instanceof Error
          ? error.message
          : "ticket execution findings are invalid",
      ),
    };
  }
  return ticketProducedResult(
    content,
    claim,
    view,
    outcome.outputs,
    manifestReference,
    decoded,
  );
}

async function ticketProducedResult(
  content: TicketContentStore,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
  rawOutputs: unknown,
  manifestReference: task.ContentRef,
  decoded: {
    readonly value: number;
    readonly findings: readonly task.ResultFinding[];
  },
): Promise<TicketExecutionResult> {
  try {
    const published = await ticketOutputs(content, claim, view, rawOutputs);
    return ticketValidated(
      content,
      claim,
      manifestReference,
      published,
      decoded.value,
      decoded.findings,
    );
  } catch (error) {
    return {
      result: "ProcessFailed",
      terminal: await ticketFailure(
        content,
        claim,
        error instanceof Error ? error.message : "workload outputs are invalid",
      ),
    };
  }
}

async function ticketValidated(
  content: TicketContentStore,
  claim: TicketExecutionClaim,
  manifest: task.ContentRef,
  outputs: readonly task.GitOutput[],
  value: number,
  findings: readonly task.ResultFinding[],
): Promise<TicketExecutionResult> {
  try {
    return {
      result: "Produced",
      terminal: new task.TaskResultProduced(
        task.ValidatedTaskResult.produce(
          claim.obligation,
          manifest,
          outputs,
          value,
          findings,
        ),
      ),
    };
  } catch (error) {
    return {
      result: "ProcessFailed",
      terminal: await ticketFailure(
        content,
        claim,
        error instanceof Error ? error.message : "workload result is invalid",
      ),
    };
  }
}

export async function ticketExecutionVerdict(
  content: TicketContentStore,
  claim: TicketExecutionClaim,
  manifest: Record<string, unknown>,
): Promise<{
  readonly value: number;
  readonly findings: readonly task.ResultFinding[];
}> {
  if (!(claim.obligation.task instanceof task.EvaluationTaskId))
    return { value: 1, findings: [] };
  const verdict = Object.hasOwn(manifest, "verdict")
    ? manifest["verdict"]
    : "pass";
  if (!["pass", "passed", "fail", "failed"].includes(String(verdict)))
    throw new TypeError("ticket execution manifest verdict is invalid");
  const findings: task.ResultFinding[] = [];
  const rawFindings = manifest["findings"] ?? [];
  if (!Array.isArray(rawFindings) || rawFindings.length > task.FINDING_LIMIT)
    throw new TypeError("ticket execution findings are invalid");
  const seen = new Set<number>();
  for (const [offset, raw] of rawFindings.entries()) {
    const finding = ticketRecord(raw, "finding");
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
    findings.push(
      new task.ResultFinding(
        identifier,
        await content.put("text/plain", description),
      ),
    );
  }
  const passed = verdict === "pass" || verdict === "passed";
  if (passed && findings.length > 0)
    throw new TypeError("a passing evaluator manifest cannot contain findings");
  return { value: passed ? 1 : 0, findings };
}

async function ticketOutputs(
  content: TicketContentStore,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
  raw: unknown,
): Promise<readonly task.GitOutput[]> {
  if (!Array.isArray(raw))
    throw new TypeError("ticket execution outputs must be an array");
  if (view.access === "ReadRepository") {
    if (raw.length !== 0)
      throw new TypeError("read-only ticket execution produced an output");
    return [];
  }
  if (raw.length !== 1)
    throw new TypeError("publishing ticket execution must produce one output");
  const output = ticketRecord(raw[0], "output");
  if (output["repository"] !== view.repository)
    throw new TypeError("ticket execution output repository is invalid");
  const commit = output["commit"];
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/iu.test(commit))
    throw new TypeError("ticket execution output commit is invalid");
  const normalized = commit.toLowerCase();
  return [
    new task.GitOutput(
      new task.WorkspaceSource(
        claim.obligation.definition.execution_requirements.repository,
        task.Digest(await content.put("text/plain", normalized)),
      ),
    ),
  ];
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
    return {
      result: "ProcessFailed",
      terminal: await ticketFailure(
        content,
        claim,
        error instanceof Error ? error.message : "worker outcome is invalid",
      ),
    };
  }
  if (outcome.type === "result")
    return ticketProduced(content, claim, view, outcome);
  const evidence =
    typeof outcome.evidence === "string"
      ? outcome.evidence
      : "ticket worker returned an invalid outcome";
  const reference = await content.put("text/plain", evidence);
  if (outcome.type === "execution_unavailable")
    return { result: "ExecutionUnavailable", evidence: reference };
  return {
    result: "ProcessFailed",
    terminal: new task.TaskProcessFailed(
      new task.TaskFailure(claim.obligation.task, reference),
    ),
  };
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
