/**
 * One of the project's images, drawn from the project's own read of it.
 *
 * IT IS DRAWN AS A `data:` URI BUILT FROM THE READ'S OWN BASE64. The console's
 * document admits no other image source, and the API's address is not one, so
 * nothing is fetched by the document beyond the authenticated read made here.
 * An artifact never changes once written, so the read is made once a page and
 * shared by everything drawing it, and bytes already in hand are written
 * under the same key rather than read back.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type {
  ImageMediaType,
  PartitionIdentity,
} from "../../../../src/contract/http.ts";
import type { ProjectArtifactResponse } from "../../../../src/contract/responses.ts";
import { conversationBase64 } from "../core/conversationAttachments.ts";
import { projectImageQuery } from "../core/projectQueries.ts";
import { usePanelState } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";

export function ProjectImage(props: {
  readonly partition: PartitionIdentity;
  readonly artifact: string;
  readonly alt: string;
  readonly className: string;
}): ReactNode {
  const state = usePanelState(
    projectImageQuery(props.partition, props.artifact),
  );
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  return (
    <img
      className={props.className}
      src={`data:${state.value.mediaType};base64,${state.value.content}`}
      alt={props.alt}
    />
  );
}

/** Where the bytes an upload sent are written as the read of what it answered. */
export function useProjectImageHeld(
  partition: PartitionIdentity,
): (artifact: string, mediaType: ImageMediaType, content: Uint8Array) => void {
  const client = useQueryClient();
  return (artifact, mediaType, content) => {
    const read: ProjectArtifactResponse = {
      mediaType,
      content: conversationBase64(content),
      encoding: "base64",
    };
    client.setQueryData(projectImageQuery(partition, artifact).queryKey, read);
  };
}
