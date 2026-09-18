/**
 * The repository and commit a ticket's work runs against.
 *
 * THE DOMAIN NO LONGER MODELS EITHER. It carries a ticket's source as one
 * opaque content reference and leaves what that refers to to whoever resolves
 * it, so the pair the fabric needs — which repository, which commit — is
 * written as a content document and read back here. One module spells the
 * document, because a second speller is a second version of it.
 */
import type { ContentRef } from "../domain/chuggernaut/task.js";
import { canonical_json } from "./json.ts";
import type { TicketContentStore } from "./ticketCatalog.ts";

export interface TicketWorkspace {
  readonly repository: string;
  readonly commit: string;
}

export function ticketWorkspacePut(
  content: TicketContentStore,
  workspace: TicketWorkspace,
): Promise<ContentRef> {
  return content.put(
    "application/json",
    canonical_json({
      commit: workspace.commit,
      repository: workspace.repository,
    }),
  );
}

/** Reads back a source document, refusing anything this module did not write. */
export async function ticketWorkspaceRead(
  content: TicketContentStore,
  reference: ContentRef,
): Promise<TicketWorkspace> {
  const found = await content.read(reference);
  if (found?.mediaType !== "application/json")
    throw new Error("ticket workspace source is missing");
  const value: unknown = JSON.parse(found.content);
  if (value === null || typeof value !== "object")
    throw new TypeError("ticket workspace source is not an object");
  const row = value as Record<string, unknown>;
  const { repository, commit } = row;
  if (
    typeof repository !== "string" ||
    repository.length === 0 ||
    typeof commit !== "string" ||
    commit.length === 0
  )
    throw new TypeError("ticket workspace source is incomplete");
  return { repository, commit };
}
