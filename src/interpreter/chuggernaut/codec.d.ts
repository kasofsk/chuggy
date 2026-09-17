import * as ticket from "../../domain/chuggernaut/ticket.js";
export type Json =
  | number
  | string
  | boolean
  | Json[]
  | {
      [key: string]: Json;
    };
export declare class CodecError extends Error {}
export declare class Variants<T> {
  readonly union: string;
  readonly _type: T;
  constructor(union: string);
}
export declare const TICKET_COMMAND: Variants<ticket.TicketCommand>;
export declare const TICKET_DECISION: Variants<ticket.TicketDecision>;
export declare const TICKET_EVENT: Variants<ticket.TicketEvent>;
export declare const TICKET_REFUSAL: Variants<ticket.TicketRefusal>;
export declare const TICKET_STATE: Variants<ticket.TicketState>;
export declare const OBLIGATION: Variants<ticket.Obligation>;
export declare function register_records(
  records: Record<string, unknown>,
): void;
export { canonical_json } from "./json.js";
export declare function encode(value: unknown): string;
export declare function decode<T>(
  text: string,
  expected:
    | Variants<T>
    | {
        readonly prototype: T;
        readonly name: string;
      },
): T;
