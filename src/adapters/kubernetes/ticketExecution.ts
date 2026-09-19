/**
 * Places an adopted ticket task as an isolated Kubernetes pod and answers
 * whether it could.
 *
 * THIS BACKEND READS NO RESULT. What a harness submits means what
 * `ticketExecutionOutcome.ts` says it means, one protocol above every backend,
 * so nothing here compiles a result contract, mints a reference or decides a
 * verdict; the outcome the plane recorded travels back through this module
 * untouched. A worker pool this tree did not write answers the same narrow
 * port, and could not be asked to hold the ticket domain at all.
 */
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type {
  CredentialResolved,
  RepositoryBinding,
} from "../../interpreter/finalizer.ts";
import { asRepositoryId } from "../../interpreter/finalizer.ts";
import type { ProjectRepositoryBindingRead } from "../../interpreter/repositoryConfiguration.ts";
import type {
  TicketExecutionClaim,
  TicketExecutionPlacement,
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

interface TicketRunnerState {
  readonly terminals: TicketExecutionTerminals;
  readonly bindings: ProjectRepositoryBindingRead;
  readonly credentials: TicketRepositoryCredentials;
  readonly config: KubernetesTicketExecutionConfig;
  readonly fetcher: typeof fetch;
  readonly mint: () => string;
}

function ticketUnavailable(evidence: string): TicketExecutionPlacement {
  return { placed: "Unavailable", evidence };
}

function ticketRetry(
  state: TicketRunnerState,
  evidence: string,
): TicketExecutionPlacement {
  return {
    placed: "Retry",
    retryAfterSecs: state.config.retryAfterSecs,
    evidence,
  };
}

async function ticketRepository(
  state: TicketRunnerState,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
): Promise<string | TicketExecutionPlacement> {
  const binding = await state.bindings.binding(
    claim.partition,
    asRepositoryId(view.repository),
  );
  if (binding === undefined)
    return ticketUnavailable("repository is not bound to the project");
  const resolved = await state.credentials.credential(binding, view.access);
  if (resolved.resolved === "Unavailable")
    return ticketRetry(state, "repository credential is unavailable");
  if (resolved.resolved === "Denied")
    return ticketUnavailable("repository credential was denied");
  try {
    return ticketRemote(
      binding.repository,
      state.config.credentialUsername,
      resolved.credential,
    );
  } catch (error) {
    return ticketUnavailable(
      error instanceof Error ? error.message : "repository binding is invalid",
    );
  }
}

async function ticketPoll(
  state: TicketRunnerState,
  claim: TicketExecutionClaim,
  pod: KubernetesPod,
): Promise<TicketExecutionPlacement> {
  for (let poll = 0; poll < state.config.outcomePollsMax; poll += 1) {
    const outcome = await state.terminals.outcome(claim);
    if (outcome !== undefined) {
      await kubernetesCancelPod(state.config, state.fetcher, pod.metadata.name);
      return { placed: "Reported", outcome };
    }
    if (!(await state.terminals.renew(claim, state.config.leaseSecs))) {
      await kubernetesCancelPod(state.config, state.fetcher, pod.metadata.name);
      return ticketRetry(state, "ticket execution claim was fenced");
    }
    if (poll + 1 < state.config.outcomePollsMax)
      await delay(state.config.outcomePollMs);
  }
  await kubernetesCancelPod(state.config, state.fetcher, pod.metadata.name);
  return ticketRetry(
    state,
    "ticket worker outcome exceeded its operational bound",
  );
}

async function ticketLaunch(
  state: TicketRunnerState,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
  repository: string,
  bearer: string,
): Promise<TicketExecutionPlacement> {
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
    return ticketRetry(state, "ticket worker pod is unavailable");
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
    return ticketRetry(state, "ticket worker Secret is unavailable");
  }
  return ticketPoll(state, claim, pod);
}

async function ticketRun(
  state: TicketRunnerState,
  claim: TicketExecutionClaim,
  view: TicketExecutionView,
): Promise<TicketExecutionPlacement> {
  const workload = ticketRecord(view.workload, "workload");
  if (workload["cloud_identity"] !== undefined)
    return ticketUnavailable(
      "cloud identity delivery is unavailable for adopted ticket workers",
    );
  const repository = await ticketRepository(state, claim, view);
  if (typeof repository !== "string") return repository;
  const bearer = state.mint();
  if (!(await state.terminals.bind(claim, bearer)))
    return ticketRetry(state, "ticket execution claim was fenced");
  return ticketLaunch(state, claim, view, repository, bearer);
}

export function kubernetesTicketExecutionRunner(
  terminals: TicketExecutionTerminals,
  bindings: ProjectRepositoryBindingRead,
  credentials: TicketRepositoryCredentials,
  input: KubernetesTicketExecutionConfig,
  fetcher: typeof fetch = fetch,
  mint: () => string = () => randomBytes(32).toString("base64url"),
): TicketExecutionRunner {
  const state: TicketRunnerState = {
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
