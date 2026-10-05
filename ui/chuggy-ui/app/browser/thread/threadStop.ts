/**
 * What one press of Stop does on a member's own thread.
 *
 * THE PRESS IS THE STOP. The turn reads as stopped from the press, and the
 * door is asked behind that, so a member is shown nothing written after they
 * asked for no more.
 *
 * THE MAILBOX HAS THE LAST WORD. A press says its turn stopped only while the
 * mailbox read lists that turn as out, and the read that lists it ended says
 * how. A door that says its thread is closed leaves the press standing for
 * that read.
 *
 * A PRESS THAT STOPPED NOTHING IS TAKEN BACK AT ONCE, and counted so the page
 * hears the turn afresh. A turn that had ended by itself reads as it would
 * have, and nothing is said; a turn the door refused to stop is out again,
 * and the page is told which and why.
 *
 * A STOP PRESSED BEFORE ITS MESSAGE WAS TAKEN FOLLOWS THE SEND. The door knows
 * no turn nobody has sent, so each send on its way is held under its turn, and
 * a stop of that turn waits for it and goes to the thread it reached; a send
 * the door refused leaves nothing to stop.
 */

import { useMemo, useRef, useState } from "react";

import { threadBacklogMax } from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiStopThreadTurn } from "../../core/apiRoutes.ts";
import {
  threadStopFrom,
  threadStoppingWith,
  threadStoppingWithout,
} from "../../core/threads.ts";
import { useApiPorts } from "../api.ts";

/** The thread a send on its way is taken on, or none where the door hands its
 * text back. */
type ThreadStopFlight = Promise<string | undefined>;

/** What one thread holds of its stops. */
export interface ThreadStopHeld {
  /** The turns a press named, less each press taken back. */
  readonly stopping: ReadonlySet<string>;
  /** How many presses the door's answer took back. */
  readonly takenBack: number;
  /** Holds one send under its turn while it is on its way, and answers as the
   * send does. */
  readonly flown: (turn: string, flight: ThreadStopFlight) => ThreadStopFlight;
  /** Stops one turn: on the thread its send reaches where that is on its way,
   * and on `session` otherwise. It answers once the door has, or once there
   * is nothing to ask it. */
  readonly stop: (turn: string, session: string | undefined) => Promise<void>;
}

/** One send held under its turn until the door answers it, where fewer are
 * held than the mailbox takes turns. */
async function threadStopFlown(
  flights: Map<string, ThreadStopFlight>,
  turn: string,
  flight: ThreadStopFlight,
): ThreadStopFlight {
  if (flights.size >= threadBacklogMax) return flight;
  flights.set(turn, flight);
  try {
    return await flight;
  } finally {
    flights.delete(turn);
  }
}

export function useThreadStop(input: {
  readonly partition: PartitionIdentity;
  /** Told the turn each time the door refuses to stop one, and the word for
   * the cause where a member can act on it. */
  readonly onRefused: (turn: string, cause: string | undefined) => void;
}): ThreadStopHeld {
  const ports = useApiPorts();
  const { partition, onRefused } = input;
  const flights = useRef(new Map<string, ThreadStopFlight>());
  const [stopping, setStopping] = useState<readonly string[]>([]);
  const [takenBack, setTakenBack] = useState(0);
  const named = useMemo(() => new Set(stopping), [stopping]);
  const back = (turn: string): void => {
    setStopping((before) => threadStoppingWithout(before, turn));
  };
  const asked = async (turn: string, reached: ThreadStopFlight) => {
    const session = await reached;
    if (session === undefined) {
      back(turn);
      return;
    }
    const stop = threadStopFrom(
      await apiStopThreadTurn(ports, partition, session, turn),
    );
    if (stop.stop === "Ended") return;
    back(turn);
    setTakenBack((count) => count + 1);
    if (stop.stop === "Refused") onRefused(turn, stop.cause);
  };
  return {
    stopping: named,
    takenBack,
    flown: (turn, flight) => threadStopFlown(flights.current, turn, flight),
    stop: (turn, session) => {
      setStopping((before) => threadStoppingWith(before, turn));
      return asked(turn, flights.current.get(turn) ?? Promise.resolve(session));
    },
  };
}
