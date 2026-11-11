/**
 * Who may answer one native action, and what an answer to it must carry.
 *
 * AN ESCALATION AND A FINALIZATION APPROVAL ARE ANSWERED UNDER `Mutate`, as
 * every submission is that names no permit of its own. An evaluation approval
 * is answered by whom its approvers name, as the ticket was released with
 * them: `Developer` is anyone holding the project's develop permit, `Admin`
 * anyone holding its administer permit, and a list exactly the principals it
 * names, each of whom must still read the project. The rule is read from the
 * approvers alone; the action's stored capability is a tag of its kind and
 * decides nothing.
 *
 * A PERSON ANSWERS AN EVALUATION APPROVAL, NEVER AN AGENT. A request a session
 * bearer carried is a session's, whichever principal it is authorized as, and
 * the site's selector is the lead's own identity; neither answers one,
 * whatever permits it holds.
 *
 * NOT FOUND IS WHAT A CALLER WHO MAY NOT READ IS TOLD. Every other refusal is
 * named, so a member who may write the project but is not an approver is told
 * why, rather than that the action is not there.
 */

import type {
  NativeActionAnswerRefusalCode,
  NativeActionKind,
} from "../contract/rosters.ts";
import type { SessionId } from "./agentSession.ts";
import type { Authority } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { NativeActionResolution } from "./projectCommand.ts";
import type { Partition } from "./projectStore.ts";
import type { ApprovalApprovers } from "./workloadConfiguration.ts";

/** Who is asking: the principal a request authenticated as, and the session that carried it where one did. */
export interface NativeActionCaller {
  readonly principal: Principal;
  readonly viaSession?: SessionId;
}

/** The principals that are agents rather than people, which is the site's selector where the deployment names one. */
export interface NativeActionAgents {
  readonly selector?: Principal;
}

/** What one action asks, as far as who may answer it: its kind, and an evaluation approval's approvers. */
export type NativeActionAsked =
  | { readonly kind: Exclude<NativeActionKind, "EvaluationApproval"> }
  | {
      readonly kind: "EvaluationApproval";
      readonly approvers: ApprovalApprovers;
    };

/** Whether a caller may answer an action: under the authority it acts as, not at all, or not as far as it is told. */
export type NativeActionAnswerer =
  | { readonly answerer: "Answerer"; readonly authority: Authority }
  | { readonly answerer: "NotFound" }
  | {
      readonly answerer: "Refused";
      readonly code: Extract<
        NativeActionAnswerRefusalCode,
        "ApproverNotAPerson" | "NotAnApprover"
      >;
    };

/** Whether the caller is an agent or a session, neither of which a person's approval is asked of. */
function nativeActionAnswererIsAgent(
  agents: NativeActionAgents,
  caller: NativeActionCaller,
): boolean {
  return (
    caller.viaSession !== undefined || caller.principal === agents.selector
  );
}

/** The authority under which a caller who reads the project is one of the approvers, or none. */
async function nativeActionAnswererApproves(
  access: ProjectAccess,
  caller: NativeActionCaller,
  partition: Partition,
  approvers: ApprovalApprovers,
  read: Authority,
): Promise<Authority | undefined> {
  if (approvers === "Developer")
    return access.authorize(caller.principal, partition, "Mutate");
  if (approvers === "Admin")
    return access.authorize(caller.principal, partition, "Administer");
  return approvers.includes(caller.principal) ? read : undefined;
}

/** Whether `caller` may answer the action `asked` describes, asked of the project's access. */
export async function nativeActionAnswerer(
  access: ProjectAccess,
  agents: NativeActionAgents,
  caller: NativeActionCaller,
  partition: Partition,
  asked: NativeActionAsked,
): Promise<NativeActionAnswerer> {
  if (asked.kind !== "EvaluationApproval") {
    const authority = await access.authorize(
      caller.principal,
      partition,
      "Mutate",
    );
    return authority === undefined
      ? { answerer: "NotFound" }
      : { answerer: "Answerer", authority };
  }
  const read = await access.authorize(caller.principal, partition, "Read");
  if (read === undefined) return { answerer: "NotFound" };
  if (nativeActionAnswererIsAgent(agents, caller))
    return { answerer: "Refused", code: "ApproverNotAPerson" };
  const authority = await nativeActionAnswererApproves(
    access,
    caller,
    partition,
    asked.approvers,
    read,
  );
  return authority === undefined
    ? { answerer: "Refused", code: "NotAnApprover" }
    : { answerer: "Answerer", authority };
}

/** Why an answer's feedback is refused for the action it answers, or nothing where it is what that action asks for. */
export function nativeActionFeedbackRefusal(
  kind: NativeActionKind,
  resolution: NativeActionResolution,
  feedback: string | undefined,
):
  | Extract<
      NativeActionAnswerRefusalCode,
      "FeedbackNotAsked" | "RejectionWithoutFeedback"
    >
  | undefined {
  if (kind !== "EvaluationApproval")
    return feedback === undefined ? undefined : "FeedbackNotAsked";
  return resolution === "Reject" && feedback === undefined
    ? "RejectionWithoutFeedback"
    : undefined;
}

/** The caller a request names, with the session that carried it where one did. */
export function nativeActionCallerOf(
  principal: Principal,
  viaSession: SessionId | undefined,
): NativeActionCaller {
  return viaSession === undefined ? { principal } : { principal, viaSession };
}

/** What a read action asks of whoever answers it, refusing an evaluation approval that names no approvers. */
function nativeActionAskedOf(action: {
  readonly kind: NativeActionKind;
  readonly approval?: { readonly approvers: ApprovalApprovers };
}): NativeActionAsked {
  if (action.kind !== "EvaluationApproval") return { kind: action.kind };
  if (action.approval === undefined)
    throw new Error(
      "native action answer: an evaluation approval reads with no approvers",
    );
  return { kind: action.kind, approvers: action.approval.approvers };
}

/** `access` asking each kind at most once, which is all one caller in one project can be asked. */
function nativeActionAccessOnce(access: ProjectAccess): ProjectAccess {
  const asked = new Map<string, Promise<Authority | undefined>>();
  return {
    ...access,
    authorize: (principal, partition, kind) => {
      const known = asked.get(kind);
      if (known !== undefined) return known;
      const answer = access.authorize(principal, partition, kind);
      asked.set(kind, answer);
      return answer;
    },
  };
}

/** Each of `actions` with whether `caller` may answer it beside it. */
export async function nativeActionsAnswerable<
  Action extends {
    readonly kind: NativeActionKind;
    readonly approval?: { readonly approvers: ApprovalApprovers };
  },
>(
  access: ProjectAccess,
  agents: NativeActionAgents,
  caller: NativeActionCaller,
  partition: Partition,
  actions: readonly Action[],
): Promise<readonly (Action & { readonly answerable: boolean })[]> {
  const once = nativeActionAccessOnce(access);
  const answered: (Action & { readonly answerable: boolean })[] = [];
  for (const action of actions) {
    const answerer = await nativeActionAnswerer(
      once,
      agents,
      caller,
      partition,
      nativeActionAskedOf(action),
    );
    answered.push({ ...action, answerable: answerer.answerer === "Answerer" });
  }
  return answered;
}
