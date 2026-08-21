import { createHash, randomUUID } from "node:crypto";

import type pg from "pg";

import {
  artifactStore,
  type ArtifactStoreOptions,
} from "./adapters/artifacts/artifactStore.ts";
import { postgresOperationInbox } from "./adapters/postgres/operationInbox.ts";
import { postgresNativeReads } from "./adapters/postgres/nativeReads.ts";
import { postgresAuthoring } from "./adapters/postgres/authoring.ts";
import { postgresNotifications } from "./adapters/postgres/notifications.ts";
import { postgresDispatchViews } from "./adapters/postgres/dispatchViews.ts";
import { postgresProjectInventory } from "./adapters/postgres/projectInventory.ts";
import {
  postgresSelectorState,
  type SelectorRetryConfig,
} from "./adapters/postgres/selector.ts";
import { authorizedProjectInventory } from "./interpreter/projectInventory.ts";
import {
  selectorHistory,
  type SelectorHistory,
} from "./interpreter/selectorHistory.ts";
import type {
  SelectorPolicy,
  SelectorStateStore,
} from "./interpreter/selector.ts";
import {
  selectorRunOnce,
  type SelectorIdentityFactory,
  type SelectorRunResult,
  type SelectorRuntimeConfig,
} from "./interpreter/selectorRuntime.ts";
import {
  selectorNativeSource,
  type SelectorNativeApi,
} from "./interpreter/selectorNativeSource.ts";
import { postgresFinalizer } from "./adapters/postgres/finalizer.ts";
import {
  asFinalizationAttemptId,
  asInputBundleId,
  checkedFinalizerConfig,
  finalizerDefaults,
  type FinalizerConfig,
  type GitPromotionPort,
} from "./interpreter/finalizer.ts";
import {
  asProjectArtifactId,
  type CanonicalFinalization,
  type FinalizerIdentityFactory,
} from "./interpreter/finalizerPreparation.ts";
import type { FinalizerService } from "./interpreter/finalizerRun.ts";
import { postgresProjectDecision } from "./adapters/postgres/projectDecision.ts";
import { postgresProjectDiscovery } from "./adapters/postgres/projectDiscovery.ts";
import { postgresProjectStore } from "./adapters/postgres/projectStore.ts";
import type { IdempotencyKeying } from "./adapters/postgres/keying.ts";
import type { OperationInbox } from "./interpreter/operationInbox.ts";
import {
  nativeWeb,
  type NativeWeb,
  type Principal,
  type ProjectAccess,
  type ProjectInventory,
} from "./interpreter/nativeWeb.ts";
import type { ProjectDecision } from "./interpreter/projectDecision.ts";
import type { ExecutionBacklogGuard } from "./interpreter/schedulerContext.ts";
import type { ProjectDiscovery } from "./interpreter/projectDiscovery.ts";
import type { ProjectStore } from "./interpreter/projectStore.ts";
import {
  silentTicketServiceMetrics,
  ticketServiceDefaults,
  type TicketServiceConfig,
  type TicketServiceMetrics,
} from "./interpreter/ticketService.ts";

export interface TicketService {
  readonly inbox: OperationInbox;
  readonly discovery: ProjectDiscovery;
  readonly decisions: ProjectDecision;
  readonly projects: ProjectStore;
}

export interface SelectorService {
  readonly state: SelectorStateStore;
  readonly history: SelectorHistory;
  runOnce(config?: SelectorRuntimeConfig): Promise<SelectorRunResult>;
}

export interface SelectorServiceRuntime {
  readonly native: SelectorNativeApi;
  readonly principal: Principal;
  readonly policy: SelectorPolicy;
  readonly identities: SelectorIdentityFactory;
  readonly retry?: SelectorRetryConfig;
}

/** Wires selector-owned durability and project-authorized semantic history reads. */
export function composeSelectorService(
  selectorPool: pg.Pool,
  access: ProjectAccess,
  runtime: SelectorServiceRuntime,
): SelectorService {
  const state = postgresSelectorState(selectorPool, runtime.retry);
  const source = selectorNativeSource(runtime.native, runtime.principal);
  return {
    state,
    history: selectorHistory(access, state),
    runOnce: (config) =>
      selectorRunOnce(
        state,
        source,
        runtime.policy,
        runtime.identities,
        config,
      ),
  };
}

/** What a finalizer deployment answers its own ports with, none of it read from an environment. */
export interface FinalizerServiceRuntime {
  readonly git: GitPromotionPort;
  readonly artifactRoot: string;
  readonly artifacts?: ArtifactStoreOptions;
}

/** The identities one preparation mints, which the layer below may not draw for itself. */
function finalizerIdentities(): FinalizerIdentityFactory {
  return {
    next: () => ({
      attempt: asFinalizationAttemptId(`attempt-${randomUUID()}`),
      bundle: asInputBundleId(`bundle-${randomUUID()}`),
      conflict: asProjectArtifactId(`conflict-${randomUUID()}`),
    }),
  };
}

/** The hash the finalizer's canonical bytes are digested under. */
function finalizerDigestOf(canonical: CanonicalFinalization): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Wires the finalizer's durable authority to its finalizer-role credentials, the
 * Git port its caller composes and one project-owned artifact store, which is
 * where a credential and a storage root are answered from and never the
 * environment.
 */
export function composeFinalizerService(
  finalizerPool: pg.Pool,
  runtime: FinalizerServiceRuntime,
  config: FinalizerConfig = finalizerDefaults,
): FinalizerService {
  const artifacts = artifactStore({
    ...runtime.artifacts,
    root: runtime.artifactRoot,
  });
  return {
    store: postgresFinalizer(finalizerPool),
    git: runtime.git,
    handoffs: artifacts,
    artifacts,
    identities: finalizerIdentities(),
    digestOf: finalizerDigestOf,
    config: checkedFinalizerConfig(config),
  };
}

/** Wires the authenticated web application to API-role PostgreSQL ports. */
export function composeNativeWeb(
  apiPool: pg.Pool,
  keying: IdempotencyKeying,
  access: ProjectAccess,
  backlog: ExecutionBacklogGuard,
  config: TicketServiceConfig = ticketServiceDefaults,
  metrics: TicketServiceMetrics = silentTicketServiceMetrics,
  inventory?: ProjectInventory,
): NativeWeb {
  const inbox = postgresOperationInbox(apiPool, keying, config, metrics);
  return nativeWeb(
    access,
    postgresNativeReads(apiPool),
    inbox,
    postgresAuthoring(apiPool),
    postgresNotifications(apiPool),
    backlog,
    postgresDispatchViews(apiPool),
    inventory ??
      authorizedProjectInventory(access, postgresProjectInventory(apiPool)),
  );
}

/** Wires the ticket-service contracts to separate API and writer credentials. */
export function composeTicketService(
  apiPool: pg.Pool,
  writerPool: pg.Pool,
  keying: IdempotencyKeying,
  config: TicketServiceConfig = ticketServiceDefaults,
  metrics: TicketServiceMetrics = silentTicketServiceMetrics,
): TicketService {
  return {
    inbox: postgresOperationInbox(apiPool, keying, config, metrics),
    discovery: postgresProjectDiscovery(writerPool, metrics),
    decisions: postgresProjectDecision(writerPool, metrics),
    projects: postgresProjectStore(writerPool),
  };
}
