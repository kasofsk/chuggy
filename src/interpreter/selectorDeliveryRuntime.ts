import {
  deliverSelectorProposal,
  reconcileSelectorProposal,
  type SelectorOperationSource,
  type SelectorStateStore,
  type SelectorTicketService,
} from "./selector.ts";
import type { SelectorRunFailure } from "./selectorRuntimeTypes.ts";

type SelectorDeliverySource = SelectorTicketService & SelectorOperationSource;

export async function deliverPendingSelectorProposals(
  store: SelectorStateStore,
  source: SelectorDeliverySource,
  limit: number,
): Promise<{ delivered: number; failures: readonly SelectorRunFailure[] }> {
  let delivered = 0;
  const failures: SelectorRunFailure[] = [];
  try {
    for (const delivery of await store.pending(limit)) {
      if (
        (await deliverSelectorProposal(store, source, delivery)).result ===
        "Delivered"
      )
        delivered += 1;
      else
        failures.push({
          phase: "Delivery",
          partition: delivery.partition,
          decision: delivery.decision,
        });
    }
  } catch {
    failures.push({ phase: "DeliveryClaim" });
  }
  return { delivered, failures };
}

export async function reconcileSubmittedSelectorProposals(
  store: SelectorStateStore,
  source: SelectorDeliverySource,
  limit: number,
): Promise<{ reconciled: number; failures: readonly SelectorRunFailure[] }> {
  let reconciled = 0;
  const failures: SelectorRunFailure[] = [];
  try {
    for (const delivery of await store.submittedDeliveries(limit)) {
      try {
        if (await reconcileSelectorProposal(store, source, delivery))
          reconciled += 1;
      } catch {
        failures.push({
          phase: "Reconciliation",
          partition: delivery.partition,
          decision: delivery.decision,
        });
      }
    }
  } catch {
    failures.push({ phase: "ReconciliationClaim" });
  }
  return { reconciled, failures };
}
