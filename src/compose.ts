import type pg from "pg";

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

/** Wires the authenticated web application to API-role PostgreSQL ports. */
export function composeNativeWeb(
  apiPool: pg.Pool,
  keying: IdempotencyKeying,
  access: ProjectAccess,
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
