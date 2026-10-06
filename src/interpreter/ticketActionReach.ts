/**
 * The read of one ticket's action reach: where the ticket landed, what its
 * repository declares, and each action's mark, gathered for the reading
 * `./actionReach.ts` states.
 *
 * IT IS AUTHORIZED AS THE TICKET'S OWN READ IS, and a ticket the caller may
 * not read is answered as one that does not exist.
 *
 * ONE READ'S WHOLE ANSWER IS BOUNDED, in what it asks and in how long it
 * waits. Over all its actions it puts at most `ticketActionReachAsksMax`
 * questions to the port beneath the ancestry its process keeps, and it waits
 * on them for at most a stated time, which outlasts one asking's own bound
 * and ends inside the console's read timeout. An action whose mark was not
 * read inside both is `Unknown`. Only a question put to the port is counted:
 * one answered from what is kept, one that joined an asking in flight and one
 * refused at once because asking was not due cost a read none of its count.
 *
 * A READ CUT SHORT IS FINISHED BY THE READS AFTER IT, EXCEPT BEHIND QUESTIONS
 * THAT CANNOT BE DECIDED. Whatever a read asked stays kept. A decided answer
 * costs the reads after it nothing, and neither does an undecided one inside
 * its wait, so they begin past both. But an undecided question whose wait has
 * passed is put again and counted again. So an action with as many questions
 * that cannot be decided ahead of it, in the order of the actions'
 * identities, as one read may put is asked about only by a read that comes
 * inside their waits, and is `Unknown` on every read that comes after them.
 * And a question refused because the undecided places are taken
 * (`./actionReachAncestry.ts`) is put by no read while they stay taken.
 *
 * THE COMMITS ASKED ABOUT ARE THE SERVER'S OWN: the ticket's from where it
 * landed, each tip from the action's log. A caller names a ticket and nothing
 * of either.
 *
 * A REPOSITORY WHOSE BINDING IS RETIRED DECLARES NOTHING. Its rows are what it
 * last declared, as a report for one of them is told, so a ticket landed there
 * answers its commit and no actions.
 */

import { assertNever } from "../domain/assertNever.ts";
import type { TicketId } from "../domain/ids.ts";
import {
  actionReachEarlierSuccessesMax,
  actionReachNext,
  type ActionReachEarlierSuccess,
  type ActionReachMark,
  type ActionReachNewest,
} from "./actionReach.ts";
import type { ActionReachAncestry } from "./actionReachAncestry.ts";
import { authorizedProjectRead } from "./authorizedProject.ts";
import type { CommitAncestry } from "./commitAncestry.ts";
import type {
  GitObjectId,
  RepositoryBinding,
  RepositoryId,
} from "./finalizer.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import type {
  RepositoryActionId,
  RepositoryActionName,
} from "./repositoryAction.ts";
import { repositoryDeclarationsMax } from "./repositoryDeclaration.ts";
import type { RuntimePacing } from "./serviceRuntime.ts";

/** How many questions one read puts to the port beneath the ancestry its process keeps, over all its actions. */
export const ticketActionReachAsksMax = 16;

/** How long one read waits on the questions it put before answering `Unknown` for the rest. */
export const ticketActionReachAnswerSecsMax = 12;

declare const ticketLandedStampBrand: unique symbol;

/** When a ticket landed, as the store wrote it and only the store reads it back. */
export type TicketLandedStamp = string & {
  readonly [ticketLandedStampBrand]: true;
};

export function asTicketLandedStamp(value: string): TicketLandedStamp {
  if (value.length === 0)
    throw new RangeError("ticket landed stamp: a value is empty");
  return value as TicketLandedStamp;
}

/** Where a ticket landed: the commit, the binding of the repository it is in and whether that binding is retired, and the time no commit holding it was reported before. */
export interface TicketLandedAt {
  readonly repository: RepositoryBinding;
  readonly retired: boolean;
  readonly commit: GitObjectId;
  readonly since: TicketLandedStamp;
}

export type TicketLanded =
  { readonly landed: "Nowhere" } | ({ readonly landed: "At" } & TicketLandedAt);

/** One action a repository declares, and the newest of what was reported of it. */
export interface ActionReachDeclared {
  readonly action: RepositoryActionId;
  readonly name: RepositoryActionName;
  readonly newest: ActionReachNewest;
}

/** Which successes one reading asks for: the newest so many of an action beneath an ordinal, each told from the stamp whether it was reported since the ticket landed. */
export interface ActionReachEarlierQuery {
  readonly partition: Partition;
  readonly action: RepositoryActionId;
  readonly beneath: number;
  readonly count: number;
  readonly since: TicketLandedStamp;
}

/** The reads the derivation is gathered from. `landed` answers nothing for a ticket the project does not have. */
export interface TicketActionReachStore {
  landed(
    partition: Partition,
    ticket: TicketId,
  ): Promise<TicketLanded | undefined>;
  declared(
    partition: Partition,
    repository: RepositoryId,
  ): Promise<readonly ActionReachDeclared[]>;
  earlier(
    query: ActionReachEarlierQuery,
  ): Promise<readonly ActionReachEarlierSuccess[]>;
}

/** One declared action and where it stands. */
export interface ActionReachRead {
  readonly action: RepositoryActionId;
  readonly name: RepositoryActionName;
  readonly mark: ActionReachMark;
}

/** What one read answers: nothing landed, or the commit, its repository and each declared action's mark in the order of their identities. */
export type TicketActionReach =
  | { readonly landed: "Nowhere" }
  | {
      readonly landed: "At";
      readonly repository: RepositoryId;
      readonly commit: GitObjectId;
      readonly actions: readonly ActionReachRead[];
    };

export interface TicketActionReaches {
  /** Answers nothing for a ticket the caller may not read or the project does not have. */
  read(
    principal: Principal,
    partition: Partition,
    ticket: TicketId,
  ): Promise<TicketActionReach | undefined>;
}

export interface TicketActionReachPorts {
  readonly access: ProjectAccess;
  readonly store: TicketActionReachStore;
  readonly ancestry: ActionReachAncestry;
  readonly pacing: RuntimePacing;
}

/** What one read holds while it gathers: where its ticket landed, the questions it may still put, and its time, `bound` resolving as it passes. */
interface TicketActionReachReading {
  readonly partition: Partition;
  readonly landed: TicketLandedAt;
  readonly bound: Promise<"Unknown">;
  asksLeft: number;
  timePassed: boolean;
}

/** The most turns one action's reading takes: a question for each commit it may weigh, the read of its earlier successes, and the turn that marks. */
const ticketActionReachTurnsMax = actionReachEarlierSuccessesMax + 4;

/** One commit's answer for this read: what is kept, else what asking came to inside the read's bounds, else `Unknown`. */
async function ticketActionReachAnswer(
  ports: TicketActionReachPorts,
  reading: TicketActionReachReading,
  tip: GitObjectId,
): Promise<CommitAncestry> {
  const question = {
    repository: reading.landed.repository,
    candidate: reading.landed.commit,
    tip,
  };
  const decided = ports.ancestry.decided(question);
  if (decided !== undefined) return decided;
  if (reading.timePassed || reading.asksLeft < 1) return "Unknown";
  const asked = ports.ancestry.ask(question);
  if (asked.put) reading.asksLeft -= 1;
  return Promise.race([asked.answer, reading.bound]);
}

/** Reads one action's mark, gathering what the reading asks for until it has one. */
async function ticketActionReachMark(
  ports: TicketActionReachPorts,
  reading: TicketActionReachReading,
  declared: ActionReachDeclared,
): Promise<ActionReachMark> {
  const answers = new Map<GitObjectId, CommitAncestry>();
  let earlier: readonly ActionReachEarlierSuccess[] | undefined;
  for (let turn = 0; turn < ticketActionReachTurnsMax; turn += 1) {
    const next = actionReachNext({ newest: declared.newest, earlier, answers });
    switch (next.next) {
      case "Marked":
        return next.mark;
      case "Ask":
        answers.set(
          next.tip,
          await ticketActionReachAnswer(ports, reading, next.tip),
        );
        break;
      case "ReadEarlier":
        if (reading.timePassed) return { reach: "Unknown" };
        earlier = await ports.store.earlier({
          partition: reading.partition,
          action: declared.action,
          beneath: next.beneath,
          count: next.count,
          since: reading.landed.since,
        });
        break;
      default:
        return assertNever(next);
    }
  }
  throw new Error("ticket action reach: a reading did not end");
}

/** Marks each declared action in turn under one bound, which is let go once the last is marked. */
async function ticketActionReachMarks(
  ports: TicketActionReachPorts,
  partition: Partition,
  landed: TicketLandedAt,
  declared: readonly ActionReachDeclared[],
): Promise<readonly ActionReachRead[]> {
  const ended = new AbortController();
  const reading: TicketActionReachReading = {
    partition,
    landed,
    asksLeft: ticketActionReachAsksMax,
    timePassed: false,
    bound: ports.pacing
      .wait(ticketActionReachAnswerSecsMax * 1000, ended.signal)
      .then((): "Unknown" => {
        reading.timePassed = true;
        return "Unknown";
      }),
  };
  try {
    const actions: ActionReachRead[] = [];
    for (const each of declared)
      actions.push({
        action: each.action,
        name: each.name,
        mark: await ticketActionReachMark(ports, reading, each),
      });
    return actions;
  } finally {
    ended.abort();
  }
}

async function ticketActionReachRead(
  ports: TicketActionReachPorts,
  partition: Partition,
  ticket: TicketId,
): Promise<TicketActionReach | undefined> {
  const landed = await ports.store.landed(partition, ticket);
  if (landed === undefined || landed.landed === "Nowhere") return landed;
  const repository = landed.repository.repository;
  const declared = landed.retired
    ? []
    : await ports.store.declared(partition, repository);
  if (declared.length > repositoryDeclarationsMax)
    throw new RangeError("ticket action reach: more actions than one declares");
  return {
    landed: "At",
    repository,
    commit: landed.commit,
    actions: await ticketActionReachMarks(ports, partition, landed, declared),
  };
}

export function ticketActionReaches(
  ports: TicketActionReachPorts,
): TicketActionReaches {
  return {
    read: authorizedProjectRead(ports.access, (partition, ticket: TicketId) =>
      ticketActionReachRead(ports, partition, ticket),
    ),
  };
}
