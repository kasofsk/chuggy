import * as k from "../../../src/domain/chuggernaut/ticket.js";
import { DecisionStep } from "./itf.js";
export {
  ConversionError,
  decision_from_itf,
  graph_from_itf,
} from "./convert.js";
export declare class Reconstructed {
  readonly command: k.TicketCommand;
  readonly policy: k.EvaluationFailurePolicy;
  readonly origin: "action" | "event";
  constructor(
    command: k.TicketCommand,
    policy: k.EvaluationFailurePolicy,
    origin: "action" | "event",
  );
}
export declare class EvolveOnly {
  readonly reason: string;
  constructor(reason: string);
}
export type Reconstruction = Reconstructed | EvolveOnly;
export declare function command_from_step(
  step: DecisionStep,
  prior: k.TicketGraph,
): Reconstruction;
