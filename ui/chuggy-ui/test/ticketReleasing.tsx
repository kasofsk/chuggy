/**
 * What the creation screen's suites stand in for: the YAML editor as a plain
 * text area, an API that creates a draft and settles its release as
 * succeeded, and one over a draft behind its door, for the cases about a
 * draft a submit left held.
 */

import type { Answer } from "./answeringApi.ts";
import { creationDraft, creationPartition } from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

/** The editor stood in for, because what these suites check is the screen
 * around it; `ticketEditor.test.tsx` mounts the real one. */
export default function TicketEditorDouble(props: {
  readonly value: string;
  readonly onChange: (text: string) => void;
}) {
  return (
    <textarea
      aria-label="Ticket YAML"
      value={props.value}
      onChange={(event) => {
        props.onChange(event.target.value);
      }}
    />
  );
}

/** A draft created, its release accepted and settled, and the project read
 * listing the ticket it made. */
export function ticketReleasing(method: string, path: string): Answer {
  if (method === "POST" && path.endsWith("/drafts"))
    return { status: 201, body: creationDraft };
  if (method === "POST" && path.endsWith("/operations"))
    return { status: 202, body: { operation: "op", state: "Pending" } };
  if (path.includes("/operations/"))
    return {
      status: 200,
      body: {
        operation: "op",
        acceptedAt: "2026-08-26T00:00:00Z",
        state: "Succeeded",
        decidedSequence: 42,
      },
    };
  return {
    status: 200,
    body: {
      partition: creationPartition,
      sequence: 42,
      tickets: [
        {
          ticket: creationDraft.ticket,
          phase: "Pending",
          sequence: 42,
          ...ticketInstants,
        },
      ],
    },
  };
}

/** A release as the door first heard of it. */
interface TicketDoorRelease {
  readonly operation: string;
  readonly authoringVersion: number;
}

/**
 * One draft behind its door and the releases sent of it, which a case about
 * a draft a submit left held moves between one submit and the next.
 */
export interface TicketDoor {
  version: number;
  state: "Draft" | "Released" | "Deleted";
  /** The ticket has left Pending, which closes its draft to revision. */
  closed: boolean;
  releasedVersion: number | undefined;
  configurationRevision: string;
  /** Every release sent, in the order each identity was first heard. */
  readonly releases: TicketDoorRelease[];
  /** What the actor decided of each, one absent being still pending. */
  readonly decided: Map<string, Answer>;
}

export function ticketDoor(): TicketDoor {
  return {
    version: creationDraft.authoringVersion,
    state: "Draft",
    closed: false,
    releasedVersion: undefined,
    configurationRevision: creationDraft.configurationRevision,
    releases: [],
    decided: new Map(),
  };
}

function doorDraft(door: TicketDoor): Answer["body"] {
  return {
    ...creationDraft,
    authoringVersion: door.version,
    state: door.state,
    configurationRevision: door.configurationRevision,
    ...(door.releasedVersion === undefined
      ? {}
      : { releasedAuthoringVersion: door.releasedVersion }),
  };
}

function doorOperation(operation: string, over: object): Answer {
  return {
    status: 200,
    body: { operation, acceptedAt: "2026-08-26T00:00:00Z", ...over },
  };
}

/**
 * The actor deciding one release now, as the case says: carried out, left
 * pending, cancelled undecided, or refused by the code named. A release of a
 * draft no longer open at the version it names is refused whatever the case
 * says, which is the fence the durable authority holds a release to.
 */
export function ticketDoorDecides(
  door: TicketDoor,
  release: TicketDoorRelease | undefined,
  verdict: string,
): void {
  if (release === undefined || verdict === "Pending") return;
  const fenced =
    door.state === "Draft" && release.authoringVersion === door.version;
  const decided = (over: object): void => {
    door.decided.set(release.operation, doorOperation(release.operation, over));
  };
  if (!fenced || (verdict !== "Succeeded" && verdict !== "Cancelled")) {
    decided({
      state: "Refused",
      code: fenced ? verdict : "AuthoringChanged",
      refusedHead: 41,
      refusedLifecycleGeneration: 1,
    });
    return;
  }
  if (verdict === "Cancelled") {
    decided({ state: "Cancelled" });
    return;
  }
  door.state = "Released";
  door.releasedVersion = door.version;
  decided({ state: "Succeeded", decidedSequence: 42 });
}

/** A revision at the door: fenced on the draft being open to one, then on its
 * version, and applied by moving that version on. */
function doorRevised(door: TicketDoor, body: unknown): Answer {
  const revision = body as {
    readonly expectedVersion: number;
    readonly configurationRevision: string;
  };
  if (door.state === "Deleted" || door.closed)
    return { status: 409, body: { error: { code: "DraftNotEditable" } } };
  if (revision.expectedVersion !== door.version)
    return {
      status: 409,
      body: { error: { code: "DraftChanged" }, currentVersion: door.version },
    };
  door.version += 1;
  door.configurationRevision = revision.configurationRevision;
  return { status: 200, body: doorDraft(door) };
}

/** A release accepted: decided once, as the case says of the first sending
 * of its identity, and answered by that identity ever after. */
function doorAccepted(
  door: TicketDoor,
  body: unknown,
  decide: (nth: number) => string,
): Answer {
  const sent = body as {
    readonly operation: string;
    readonly mutation: { readonly authoringVersion: number };
  };
  if (!door.releases.some((one) => one.operation === sent.operation)) {
    const release = {
      operation: sent.operation,
      authoringVersion: sent.mutation.authoringVersion,
    };
    door.releases.push(release);
    ticketDoorDecides(door, release, decide(door.releases.length));
  }
  return { status: 202, body: { operation: sent.operation, state: "Pending" } };
}

/**
 * The API over that draft. `decide` says what the actor does with each
 * release as it is first sent, by its place among them, and `over` stands
 * between any request and the door's own answer to it.
 */
export function ticketDoorAnswers(
  door: TicketDoor,
  decide: (nth: number) => string,
  over: (method: string, path: string, answered: () => Answer) => Answer = (
    _method,
    _path,
    answered,
  ) => answered(),
): (method: string, path: string, body: unknown) => Answer {
  const draft = `/drafts/${String(creationDraft.ticket)}`;
  const own = (method: string, path: string, body: unknown): Answer => {
    if (method === "POST" && path.endsWith("/drafts"))
      return { status: 201, body: doorDraft(door) };
    if (path.endsWith(draft))
      return method === "PUT"
        ? doorRevised(door, body)
        : { status: 200, body: doorDraft(door) };
    if (method === "POST" && path.endsWith("/operations"))
      return doorAccepted(door, body, decide);
    if (!path.includes("/operations/")) return ticketReleasing(method, path);
    const operation = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
    return (
      door.decided.get(operation) ??
      doorOperation(operation, { state: "Pending" })
    );
  };
  return (method, path, body) =>
    over(method, path, () => own(method, path, body));
}

/** The first release refused as a configuration the project will not run,
 * and every one after it carried out: the ordinary way a draft is left held. */
export function ticketRefusedFirst(nth: number): string {
  return nth === 1 ? "ConfigurationInvalid" : "Succeeded";
}
