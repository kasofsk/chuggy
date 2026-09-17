import { Value } from "./itf.js";
export declare class ConversionError extends Error {}
import {
  TicketGraph,
  TicketDecision,
} from "../../../src/domain/chuggernaut/ticket.js";
export declare function graph_from_itf(v: Value, _where?: string): TicketGraph;
export declare function decision_from_itf(
  v: Value,
  _where?: string,
): TicketDecision;
