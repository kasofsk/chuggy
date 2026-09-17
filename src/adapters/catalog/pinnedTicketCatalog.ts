import { ContentRef } from "../../domain/chuggernaut/task.js";
import { ticketCatalog } from "./ticketCatalog.ts";
import { projectTicketCatalogSource } from "./projectCatalog.ts";
import type {
  PinnedTicketCatalogSelection,
  PinnedTicketCatalogs,
} from "../../interpreter/ticketApplication.ts";
import type {
  TicketCatalog,
  TicketCatalogSnapshotPort,
  TicketContentStore,
} from "../../interpreter/ticketCatalog.ts";
import type { Partition } from "../../interpreter/projectStore.ts";

/** Content that lives no longer than the release it serves, so validating writes nothing. */
function draftTicketContent(): TicketContentStore {
  const held: { readonly mediaType: string; readonly content: string }[] = [];
  return {
    put: (mediaType, content) =>
      Promise.resolve(ContentRef(held.push({ mediaType, content }))),
    read: (reference) => Promise.resolve(held[reference - 1]),
  };
}

/** Builds each authoring catalog from one commit-pinned repository snapshot. */
export function pinnedTicketCatalogs(
  snapshots: TicketCatalogSnapshotPort,
  content: (partition: Partition) => TicketContentStore,
): PinnedTicketCatalogs {
  const build = async (
    selection: PinnedTicketCatalogSelection,
    store: TicketContentStore,
  ): Promise<TicketCatalog | undefined> => {
    const pinned = await snapshots.snapshot(selection);
    if (pinned === undefined) return undefined;
    const source = await projectTicketCatalogSource(
      pinned.snapshot,
      pinned.repository,
    );
    return ticketCatalog(source, store);
  };
  return {
    catalog: (selection) => build(selection, content(selection.partition)),
    draft: (selection) => build(selection, draftTicketContent()),
  };
}
