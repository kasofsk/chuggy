import type { DecisionEvent } from "../actor/decisionEvent.ts";

export type OperationDecisionEvent = Exclude<
  DecisionEvent,
  { readonly type: "WorkReduce" | "EvalReduce" }
>;

export type NativeActionResolution = "Resume" | "Revoke";

export function asOperationDecisionEvent(
  event: DecisionEvent,
): OperationDecisionEvent {
  if (event.type === "WorkReduce" || event.type === "EvalReduce") {
    throw new RangeError("reducers are internal continuation commands");
  }
  return event;
}

export type TicketCommand =
  | {
      readonly version: 1;
      readonly command: "Decide";
      readonly event: OperationDecisionEvent;
    }
  | {
      readonly version: 1;
      readonly command: "ResolveNativeAction";
      readonly action: string;
      readonly authorizingSeq: number;
      readonly resolution: NativeActionResolution;
    };
