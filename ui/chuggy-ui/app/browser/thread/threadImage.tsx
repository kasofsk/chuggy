/**
 * One image a thread's message named, drawn as the project's image it is.
 */

import { useCallback } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { ProjectImage } from "../ProjectImage.tsx";

/** How a thread's conversation draws each image a message named, the same
 * drawing while it is the same project. */
export function useThreadImage(
  partition: PartitionIdentity,
): (artifact: string) => ReactNode {
  const { tenant, project } = partition;
  return useCallback(
    (artifact: string) => (
      <ProjectImage
        partition={{ tenant, project }}
        artifact={artifact}
        alt="Image sent"
        className="rounded-2 block max-h-(--height-clip) max-w-full"
      />
    ),
    [tenant, project],
  );
}
