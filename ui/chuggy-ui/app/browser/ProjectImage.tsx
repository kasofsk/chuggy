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
import { apiProjectArtifact } from "../core/apiRoutes.ts";
import { conversationBase64 } from "../core/conversationAttachments.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import { usePanelResource } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";

/** The resource one image is read under, beside the project's other reads. */
export function projectImageResource(artifact: string): string {
  return `artifacts/${artifact}`;
}

export function ProjectImage(props: {
  readonly partition: PartitionIdentity;
  readonly artifact: string;
  readonly alt: string;
  readonly className: string;
}): ReactNode {
  const state = usePanelResource(
    props.partition,
    "Project",
    projectImageResource(props.artifact),
    (ports, signal) =>
      apiProjectArtifact(ports, props.partition, props.artifact, signal),
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
    client.setQueryData(
      projectResourceKey(partition, "Project", projectImageResource(artifact)),
      read,
    );
  };
}
