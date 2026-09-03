/**
 * What a project's members may ask the lead aside, and what they read back: the
 * door that forks one inquiry, the listing every member sees, and one inquiry
 * on its own.
 *
 * ASKING IS `Read` AND NOT `Mutate`. An inquiry holds `inquiryCapabilities`,
 * which is a strict subset of what `Read` already permits, so opening one
 * grants the asker nothing they did not already hold; gating it on `Mutate`
 * would say a reader may not ask a question about what they are already allowed
 * to read, which is a control with no failure to prevent. What asking spends is
 * the project's shared account, and that is bounded by a COUNT —
 * `inquiriesOpenPerMemberMax` — rather than by an access kind that means
 * something else.
 *
 * THE LISTING IS EVERY MEMBER'S. An inquiry any member asked is an inquiry
 * every member with `Read` can see, because members cooperating is the reason
 * the lead is asked about its own thinking at all. `mine` is computed against
 * the request's own principal, so a browser can name "my inquiry" without ever
 * decoding a token, and the principal itself never crosses the wire.
 *
 * THE DOCUMENT IS COMPOSED HERE AND PARSED HERE. `open_lead_inquiry` stores a
 * string it does not read, exactly as the plane stores every turn's input, so
 * the question a member typed reaches the mailbox as an `InquiryDocument` and
 * comes back as one. A row carrying anything else is a row no door wrote, and
 * `parseInquiry` refuses it rather than showing a member a question nobody
 * asked.
 *
 * ONE TURN PER INQUIRY IS A PROPERTY OF THE MAILBOX. There is no second door:
 * `open_lead_inquiry` enqueues exactly one turn and nothing else in the tree
 * enqueues another for an `Inquiry` session. So this module declares no
 * follow-up, and a multi-turn inquiry is a durable store this slice
 * deliberately does not make.
 */

import type {
  SessionId,
  SessionState,
  SessionTurnFailure,
  SessionTurnId,
  SessionTurnMeasured,
  SessionTurnState,
} from "./agentSession.ts";
import { inquiryDocument, inquiryText, parseInquiry } from "./inquiry.ts";
import type { Principal } from "./principal.ts";
import type { Partition } from "./projectStore.ts";
import type { PublicInstant } from "./publicResource.ts";

/**
 * One inquiry as the durable listing names it. `principal` is whose it is and
 * never crosses the wire — it is what `mine` is computed against, and a listing
 * that shipped it would hand every member every other's token subject for
 * nothing — and `input` is the turn's own document, unparsed, because the read
 * that answered it is not what reads it.
 */
export interface LeadInquiryRecord {
  readonly session: SessionId;
  readonly principal: Principal;
  /** The membership's own authority subject, absent where that membership is gone. */
  readonly asker?: string;
  readonly state: SessionState;
  readonly turn: SessionTurnId;
  readonly turnState: SessionTurnState;
  readonly ordinal: number;
  /** The `InquiryDocument` text the door enqueued, which this module parses and the store did not. */
  readonly input: string;
  readonly answer?: string;
  readonly failure?: SessionTurnFailure;
  readonly askedAt: PublicInstant;
  readonly measured?: SessionTurnMeasured;
}

/**
 * What the ask door's durable half answered. Every refusal names a lead the
 * fork could not be taken from, except `InFlight`, which names the asker's own
 * quota — and they are separate arms because a member whose lead has not
 * started waits for the platform and a member with two open inquiries waits for
 * themselves.
 */
export type LeadInquiryOpened =
  | {
      readonly opened: "Opened" | "AlreadyOpen";
      readonly session: SessionId;
      readonly ordinal: number;
    }
  | {
      readonly opened: "NoLead" | "LeadNotStarted" | "LeadClosed" | "InFlight";
    };

/**
 * The durable inquiry authority migration 063 answers. `open` TAKES NO ROSTER,
 * NO ACCOUNT AND NO CREDENTIAL SLOT, and those omissions are the control: the
 * definer writes `inquiryCapabilities` itself and copies the lead's own
 * placement, so an API talked into opening an inquiry can neither widen one nor
 * put it somewhere the parent's store is not.
 */
export interface LeadInquiryStore {
  inquiries(
    partition: Partition,
    limit: number,
  ): Promise<readonly LeadInquiryRecord[]>;
  /** One inquiry, or nothing where the session is not an inquiry of this project's lead. */
  inquiry(
    partition: Partition,
    session: SessionId,
  ): Promise<LeadInquiryRecord | undefined>;
  open(input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly session: SessionId;
    readonly turn: SessionTurnId;
    /** The composed `InquiryDocument` text, which the definer stores and never reads. */
    readonly question: string;
  }): Promise<LeadInquiryOpened>;
}

/** One inquiry as the wire names it, with `mine` decided against the reader's own principal. */
export interface LeadInquiryEntry {
  readonly session: SessionId;
  readonly asker?: string;
  readonly mine: boolean;
  readonly state: SessionState;
  readonly turnState: SessionTurnState;
  readonly ordinal: number;
  readonly question: string;
  readonly answer?: string;
  readonly failure?: SessionTurnFailure;
  readonly askedAt: PublicInstant;
  readonly model?: string;
  readonly tokens?: number;
  readonly costMicros?: number;
  readonly durationMs?: number;
}

/**
 * One record as the wire carries it: the question parsed out of the turn's
 * document, the measure flattened, and `mine` decided here because nothing
 * under `ui/` knows who is signed in.
 */
export function leadInquiryEntry(
  record: LeadInquiryRecord,
  reader: Principal,
): LeadInquiryEntry {
  const { question } = parseInquiry(record.input);
  return {
    session: record.session,
    ...(record.asker === undefined ? {} : { asker: record.asker }),
    mine: record.principal === reader,
    state: record.state,
    turnState: record.turnState,
    ordinal: record.ordinal,
    question,
    ...(record.answer === undefined ? {} : { answer: record.answer }),
    ...(record.failure === undefined ? {} : { failure: record.failure }),
    askedAt: record.askedAt,
    ...(record.measured === undefined
      ? {}
      : {
          model: record.measured.model,
          tokens: record.measured.tokens,
          costMicros: record.measured.costMicros,
          durationMs: record.measured.durationMs,
        }),
  };
}

/**
 * The turn's input for one question, composed where the API knows who asked, so
 * an inquiry's document names its asker the way an operation is audited to one.
 * THE QUESTION'S BOUND IS `inquiryDocument`'S AND IS NOT RESTATED: that
 * function refuses an empty question and one past `inquiryQuestionCharsMax`
 * before composing anything, so a second check here would be one no case could
 * refute, and an unverified control is worse than none.
 */
export function leadInquiryTurnInput(input: {
  readonly question: string;
  readonly asker: string;
}): string {
  return inquiryText(inquiryDocument(input));
}

export type LeadInquiriesRead =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly inquiries: readonly LeadInquiryEntry[];
    };

export type LeadInquiryRead =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly inquiry: LeadInquiryEntry };

/**
 * What the ask door answered, every refusal one the member can act on:
 * `NotFound` a project they may not read, `NoLead` a project with no lead,
 * `LeadNotStarted` a lead with no head to fork from, `LeadClosed` a lead that
 * takes no more, `InFlight` their own unanswered questions. A question too long
 * is not an arm here: it is bounded where it is read off the wire, so it is an
 * invalid request rather than something this door met.
 */
export type LeadInquiryAsked =
  | { readonly result: "NotFound" }
  | {
      readonly result: "NoLead" | "LeadNotStarted" | "LeadClosed" | "InFlight";
    }
  | {
      readonly result: "Asked" | "AlreadyAsked";
      readonly session: SessionId;
      readonly turn: SessionTurnId;
      readonly ordinal: number;
    };

/**
 * What the durable open answered, as the door answers it. The session the
 * caller MINTED is what the answer names, and the fork the durable side reports
 * is HELD AGAINST IT: a definer that opened or found another session would
 * otherwise turn an ordinal in a fork the caller is not watching into a `202`,
 * and the caller would poll a session that answers nothing for ever.
 */
export function leadInquiryAsked(
  opened: LeadInquiryOpened,
  named: SessionId,
  turn: SessionTurnId,
): LeadInquiryAsked {
  if (opened.opened === "Opened" || opened.opened === "AlreadyOpen") {
    if (opened.session !== named)
      throw new Error(
        `lead inquiry: asking for ${named} answered ${opened.session}`,
      );
    return {
      result: opened.opened === "Opened" ? "Asked" : "AlreadyAsked",
      session: named,
      turn,
      ordinal: opened.ordinal,
    };
  }
  return { result: opened.opened };
}
