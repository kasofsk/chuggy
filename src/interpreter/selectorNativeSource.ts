import { asIdempotencyKey } from "./operationInbox.ts";
import type { NativeWeb, Principal } from "./nativeWeb.ts";
import type { SelectorRuntimeSource } from "./selectorRuntime.ts";

function inaccessible(what: string): never {
  throw new Error(`selector source cannot access ${what}`);
}

/** Adapts the authenticated ticket-service API to the selector runtime port. */
export function selectorNativeSource(
  native: SelectorNativeApi,
  principal: Principal,
): SelectorRuntimeSource {
  return {
    projects: (after, limit) =>
      native.projectInventory(principal, after, limit),
    notifications: async (partition, cursor) => {
      const result = await native.notifications(principal, partition, cursor);
      return result.result === "Authorized"
        ? result.value
        : inaccessible("project notifications");
    },
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
      return result.result === "Authorized"
        ? result.acceptance
        : inaccessible("proposal submission");
    },
    operation: (partition, operation) =>
      native.operation(principal, partition, operation),
  };
}
type SelectorNativeApi = Pick<
  NativeWeb,
  "projectInventory" | "notifications" | "dispatchView" | "submit" | "operation"
>;
