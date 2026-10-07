/**
 * One image a thread's message named, drawn from the project's own read of it.
 *
 * IT IS DRAWN AS A `data:` URI BUILT FROM THE READ'S OWN BASE64. The console's
 * document admits no other image source, and the API's address is not one, so
 * nothing is fetched by the document beyond the authenticated read made here.
 * An artifact never changes once written, so the read is made once a page and
 * shared by every turn naming it.
 */

import { useCallback } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiProjectArtifact } from "../../core/apiRoutes.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";

/** The resource one image is read under, beside the project's other reads. */
export function threadImageResource(artifact: string): string {
  return `artifacts/${artifact}`;
}

function ThreadImage(props: {
  readonly partition: PartitionIdentity;
  readonly artifact: string;
}): ReactNode {
  const state = usePanelResource(
    props.partition,
    "Project",
    threadImageResource(props.artifact),
    (ports, signal) =>
      apiProjectArtifact(ports, props.partition, props.artifact, signal),
  );
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  return (
    <img
      className="rounded-2 block max-h-(--height-clip) max-w-full"
      src={`data:${state.value.mediaType};base64,${state.value.content}`}
      alt="Image sent"
    />
  );
}

/** How a thread's conversation draws each image a message named, the same
 * drawing while it is the same project. */
export function useThreadImage(
  partition: PartitionIdentity,
): (artifact: string) => ReactNode {
  const { tenant, project } = partition;
  return useCallback(
    (artifact: string) => (
      <ThreadImage partition={{ tenant, project }} artifact={artifact} />
    ),
    [tenant, project],
  );
}
