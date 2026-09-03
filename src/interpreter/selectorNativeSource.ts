import type { NotificationBatch, NotificationCursor } from "./notifications.ts";
import { asIdempotencyKey } from "./operationInbox.ts";
import type { NativeWeb, Principal } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";
import type { SelectorProposalAcceptance } from "./selector.ts";
import type { SelectorRuntimeSource } from "./selectorRuntime.ts";

function inaccessible(what: string): never {
  throw new Error(`selector source cannot access ${what}`);
}

/**
 * Adapts the authenticated ticket-service API to the selector runtime port.
 *
 * `moved` AND `notifications` ARE ONE READ UNDER TWO NAMES: the runtime asks
 * whether a project moved before it spends a permit on it, and the observation
 * carries the same page as its window, so both are answered from the one
 * authorized read rather than from two that could disagree.
 *
 * A BACKLOGGED PROJECT CROSSES AS BACKPRESSURE RATHER THAN AS AN INACCESSIBLE
 * ONE. The guard is the scheduler pausing dispatch and it hands back the delay
 * to wait, so the delivery is deferred by that hint and stays pending. Throwing
 * it as inaccessibility would reach the runtime as a submission failure, which
 * discards the hint and never defers the delivery at all.
 */
export function selectorNativeSource(
  native: SelectorNativeApi,
  principal: Principal,
  environment: Pick<
    SelectorRuntimeSource,
    | "currentTimeEpochMs"
    | "currentInstant"
    | "decisionDeadline"
    | "operationalContext"
  >,
): SelectorRuntimeSource {
  const notifications = async (
    partition: Partition,
    cursor: NotificationCursor,
  ): Promise<NotificationBatch> => {
    const result = await native.notifications(principal, partition, cursor);
    return result.result === "Authorized"
      ? result.value
      : inaccessible("project notifications");
  };
  return {
    ...environment,
    projects: (after, limit) =>
      native.projectInventory(principal, after, limit),
    notifications,
    moved: (partition, after, limit) =>
      notifications(partition, { after, limit }),
    dispatchView: async (partition, query) => {
      const result = await native.dispatchView(principal, partition, query);
      return result.result === "Authorized"
        ? result.value
        : inaccessible("the dispatchable view");
    },
    submit: async (delivery) => {
      const result = await native.submit(principal, {
        partition: delivery.partition,
        operation: delivery.operation,
        key: asIdempotencyKey(delivery.decision),
        command: delivery.command,
      });
      if (result.result === "Backlogged")
        return {
          accepted: "Backpressure",
          retryAfterSeconds: result.retryAfterSeconds,
        };
      return result.result === "Authorized"
        ? result.acceptance
        : inaccessible("proposal submission");
    },
    operation: (partition, operation) =>
      native.operation(principal, partition, operation),
  };
}
export type SelectorNativeApi = Pick<
  NativeWeb,
  "projectInventory" | "notifications" | "dispatchView" | "operation"
> & {
  submit(
    principal: Principal,
    submission: Parameters<NativeWeb["submit"]>[1],
  ): Promise<
    | { readonly result: "NotFound" }
    | {
        readonly result: "Backlogged";
        readonly retryAfterSeconds: number;
      }
    | {
        readonly result: "Authorized";
        readonly acceptance: SelectorProposalAcceptance;
      }
  >;
};
