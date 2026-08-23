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
  postgresSelectorProposalReviews,
  postgresSelectorRuntimeControl,
  postgresSelectorState,
} from "./adapters/postgres/selector.ts";
import { authorizedProjectInventory } from "./interpreter/projectInventory.ts";
import {
  selectorHistory,
  type SelectorHistory,
} from "./interpreter/selectorHistory.ts";
import type {
  SelectorPolicyHost,
  SelectorRuntimeSettingsSource,
  SelectorStateStore,
} from "./interpreter/selector.ts";
import {
  selectorRunOnce,
  type SelectorIdentityFactory,
  type SelectorRunResult,
  type SelectorRuntimeConfig,
  type SelectorRuntimeSource,
} from "./interpreter/selectorRuntime.ts";
import {
  selectorRuntimeAdministration,
  type SelectorAdministrationAccess,
  type SelectorRuntimeAdministration,
} from "./interpreter/selectorAdmin.ts";
import {
  selectorProposalReviews,
  type SelectorProposalReviews,
} from "./interpreter/selectorReview.ts";
import {
  selectorPlanning,
  type SelectorPlanning,
} from "./interpreter/selectorPlanning.ts";
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
import {
  silentFinalizerTelemetry,
  type FinalizerTelemetry,
} from "./interpreter/finalizerTelemetry.ts";
import {
  postgresTenantAdministration,
  postgresTenantAdministrationAccess,
} from "./adapters/postgres/tenantAdmin.ts";
import type {
  TenantAdministrationAccess,
  TenantAdministrationStore,
} from "./interpreter/tenantAdmin.ts";
import { postgresProjectDecision } from "./adapters/postgres/projectDecision.ts";
import { postgresProjectDiscovery } from "./adapters/postgres/projectDiscovery.ts";
import { postgresProjectStore } from "./adapters/postgres/projectStore.ts";
import type { IdempotencyKeying } from "./adapters/postgres/keying.ts";
import type { OperationInbox } from "./interpreter/operationInbox.ts";
import {
  nativeWeb,
  type NativeWeb,
  type ProjectAccess,
  type ProjectInventory,
} from "./interpreter/nativeWeb.ts";
import type { ProjectDecision } from "./interpreter/projectDecision.ts";
import type { ProjectDiscovery } from "./interpreter/projectDiscovery.ts";
import type { ProjectStore } from "./interpreter/projectStore.ts";
import type { ExecutionBacklogGuard } from "./interpreter/schedulerContext.ts";
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
  readonly settings: SelectorRuntimeSettingsSource;
  readonly administration: SelectorRuntimeAdministration;
  readonly reviews: SelectorProposalReviews;
  readonly planning: SelectorPlanning;
}

export interface SelectorRuntimeService {
  runOnce(): Promise<SelectorRunResult>;
}

export interface TenantAdministrationService {
  readonly access: TenantAdministrationAccess;
  readonly store: TenantAdministrationStore;
}

/** Wires the independently operated selector runtime to its owned persistence. */
export function composeSelectorRuntime(
  selectorPool: pg.Pool,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  config?: SelectorRuntimeConfig,
): SelectorRuntimeService {
  const store = postgresSelectorState(selectorPool);
  const settings = postgresSelectorRuntimeControl(selectorPool);
  return {
    runOnce: () =>
      selectorRunOnce(store, source, policy, identities, settings, config),
  };
}

/**
 * Wires tenant administration to API-role PostgreSQL ports. Standing and the
 * changes it authorizes are separate ports because they answer separate
 * questions: what a caller may be offered, and whether one change is permitted.
 */
export function composeTenantAdministration(
  apiPool: pg.Pool,
): TenantAdministrationService {
  return {
    access: postgresTenantAdministrationAccess(apiPool),
    store: postgresTenantAdministration(apiPool),
  };
}

/** Wires selector-owned durability and project-authorized semantic history reads. */
export function composeSelectorService(
  selectorPool: pg.Pool,
  selectorControlPool: pg.Pool,
  selectorReviewPool: pg.Pool,
  access: ProjectAccess,
  administrationAccess: SelectorAdministrationAccess,
): SelectorService {
  const state = postgresSelectorState(selectorPool);
  return {
    state,
    history: selectorHistory(access, state),
    settings: postgresSelectorRuntimeControl(selectorPool),
    administration: selectorRuntimeAdministration(
      administrationAccess,
      postgresSelectorRuntimeControl(selectorControlPool),
    ),
    reviews: selectorProposalReviews(
      access,
      postgresSelectorProposalReviews(selectorReviewPool),
    ),
    planning: selectorPlanning(access, state),
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
  metrics: FinalizerTelemetry = silentFinalizerTelemetry,
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
    metrics,
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
