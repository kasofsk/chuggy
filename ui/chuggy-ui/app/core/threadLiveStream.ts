/**
 * One thread's live stream: what its session is writing, as it writes it.
 *
 * NOTHING HERE IS RECOVERED AND NOTHING HERE IS REPORTED. The stream is a
 * preview of what the store will hold, so a connection that is refused, drops
 * or carries a frame the contract rejects costs a reader nothing the
 * transcript does not bring a moment later: the ladder reopens it, every
 * connection opens on a snapshot, and no status leaves this module.
 *
 * THE SERVER CUTS THIS STREAM AS A MATTER OF COURSE: at the greatest age it
 * lets one reach, when the bearer it was opened with expires, and at any bound
 * it holds. Only a server that is stopping ends one whole. So a read that
 * fails is the ordinary way an open ends, and because every open begins with a
 * snapshot, one that handed a frame over was a stream that worked: the
 * transport is told so with `cut`, never counts such an open against its
 * bound, asks more rarely the more of them in a row end soon, and waits out
 * the wait a server with no room names.
 */

import { endpointPath } from "../../../../src/contract/endpoints.ts";
import {
  nativeHttpRoutes,
  partitionPath,
} from "../../../../src/contract/http.ts";
import { parseThreadLiveEvent } from "../../../../src/contract/threadLive.ts";
import type { ThreadLiveStreamEvent } from "../../../../src/contract/threadLive.ts";

import { openStream, streamHeaders } from "./streamConnection.ts";
import type {
  StreamEnd,
  StreamHandle,
  StreamPorts,
} from "./streamConnection.ts";
import type { ThreadHome } from "./threadHome.ts";

export function threadLiveUrl(home: ThreadHome, session: string): string {
  return home.scope === "Project"
    ? `${partitionPath(home.partition)}/threads/${encodeURIComponent(session)}/live`
    : endpointPath(nativeHttpRoutes.chatThreadLive, {
        tenant: home.tenant,
        session,
      });
}

/** A reader who is not signed in, may not read the project, or names a thread
 * that is not there is answered the same way however often they ask. */
function threadLiveRefused(status: number): StreamEnd | undefined {
  return status === 401 || status === 403 || status === 404
    ? { stop: `the API answered ${String(status)}` }
    : undefined;
}

const threadLiveLadderSilent = {
  opening: (): void => undefined,
  waiting: (): void => undefined,
  stopped: (): void => undefined,
};

export function openThreadLiveStream(
  ports: StreamPorts,
  home: ThreadHome,
  session: string,
  onEvent: (event: ThreadLiveStreamEvent) => void,
): StreamHandle {
  return openStream(
    ports,
    {
      url: threadLiveUrl(home, session),
      headers: streamHeaders,
      refused: threadLiveRefused,
      cut: true,
      opened: () => undefined,
      frame: (frame) => {
        onEvent(
          parseThreadLiveEvent({
            event: frame.event,
            data: JSON.parse(frame.data) as unknown,
          }),
        );
      },
    },
    threadLiveLadderSilent,
  );
}
