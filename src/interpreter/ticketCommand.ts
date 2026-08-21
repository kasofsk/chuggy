import type { DecisionEvent } from "../actor/decisionEvent.ts";
import type { TicketId } from "../domain/ids.ts";
import type { DispatchViewToken } from "./dispatchView.ts";

export type OperationDecisionEvent = Exclude<
  DecisionEvent,
  { readonly type: "WorkReduce" | "EvalReduce" | "ReleaseTicket" }
>;

export type NativeActionResolution = "Resume" | "Revoke";

export function asOperationDecisionEvent(
  event: DecisionEvent,
): OperationDecisionEvent {
  if (
    event.type === "WorkReduce" ||
    event.type === "EvalReduce" ||
    event.type === "ReleaseTicket"
  ) {
    throw new RangeError("event is not a public decision command");
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
    }
  | {
      readonly version: 1;
      readonly command: "ReleaseDraft";
      readonly ticket: TicketId;
      readonly authoringVersion: number;
      readonly configurationRevision: string;
    }
  | {
      readonly version: 1;
      readonly command: "ManualDispatch";
      readonly ticket: TicketId;
      readonly expectedTicketVersion: number;
    }
  | {
      readonly version: 1;
      readonly command: "ProposeDispatch";
      readonly ticket: TicketId;
      readonly expectedTicketVersion: number;
      readonly observedViewToken: DispatchViewToken;
      readonly selectorDecisionReference: string;
    };
