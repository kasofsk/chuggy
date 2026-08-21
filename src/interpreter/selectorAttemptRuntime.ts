import type { Partition } from "./projectStore.ts";
import {
  SelectorTerminationUnconfirmed,
  type SelectorCycleIdentity,
  type SelectorPolicyHost,
  type SelectorStateStore,
} from "./selector.ts";
import type { SelectorRunFailure } from "./selectorRuntimeTypes.ts";

/** Settles a permit after policy execution failed before an interaction committed. */
export async function settleFailedSelectorAttempt(
  store: SelectorStateStore,
  identity: SelectorCycleIdentity,
  partition: Partition,
  error: unknown,
  failures: SelectorRunFailure[],
): Promise<void> {
  if (error instanceof SelectorTerminationUnconfirmed) {
    await store
      .quarantineAttempt(identity.selectorDecisionReference)
      .catch(() => failures.push({ phase: "Quarantine", partition }));
    return;
  }
  try {
    await store.terminateAttempt(
      identity.selectorDecisionReference,
      "policy execution ended without a recorded interaction",
    );
  } catch {
    failures.push({ phase: "PermitRelease", partition });
    await store
      .quarantineAttempt(identity.selectorDecisionReference)
      .catch(() => failures.push({ phase: "Quarantine", partition }));
  }
}

/** Reconciles bounded uncertain attempts and rotates unconfirmed rows fairly. */
export async function reconcileSelectorAttempts(
  store: SelectorStateStore,
  policy: SelectorPolicyHost,
  limit = 100,
): Promise<void> {
  for (const attempt of await store.quarantinedAttempts(limit)) {
    const reconciliation = await policy.reconcileQuarantined(attempt);
    if (
      reconciliation.status === "Terminated" &&
      reconciliation.attempt === attempt
    )
      await store.terminateAttempt(attempt, reconciliation.proof);
    else await store.quarantineAttempt(attempt);
  }
}
