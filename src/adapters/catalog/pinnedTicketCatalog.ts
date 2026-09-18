import { ContentRef } from "../../domain/chuggernaut/task.js";
import { ticketCatalog } from "./ticketCatalog.ts";
import { mergedTicketCatalogSnapshot } from "./mergedTicketCatalog.ts";
import { projectTicketCatalogSource } from "./projectCatalog.ts";
import type {
  PinnedTicketCatalogSelection,
  PinnedTicketCatalogs,
} from "../../interpreter/ticketApplication.ts";
import type {
  TicketCatalog,
  TicketCatalogFragments,
  TicketCatalogSnapshotPort,
  TicketCatalogSnapshotRead,
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

/**
 * Builds each authoring catalog from one commit-pinned repository snapshot,
 * merged with the fragments the project holds durably. Every caller — listing,
 * reading, validation and release — goes through the same merged view, so a
 * runtime fragment is a fragment in exactly the way a committed one is.
 */
export function pinnedTicketCatalogs(
  snapshots: TicketCatalogSnapshotPort,
  content: (partition: Partition) => TicketContentStore,
  fragments: TicketCatalogFragments,
): PinnedTicketCatalogs {
  const merged = async (
    selection: PinnedTicketCatalogSelection,
  ): Promise<TicketCatalogSnapshotRead | undefined> => {
    const pinned = await snapshots.snapshot(selection);
    return pinned === undefined
      ? undefined
      : mergedTicketCatalogSnapshot(pinned, fragments, selection.partition);
  };
  const build = async (
    selection: PinnedTicketCatalogSelection,
    store: TicketContentStore,
  ): Promise<TicketCatalog | undefined> => {
    const view = await merged(selection);
    if (view === undefined) return undefined;
    const source = await projectTicketCatalogSource(
      view.snapshot,
      view.repository,
    );
    return ticketCatalog(source, store);
  };
  return {
    catalog: (selection) => build(selection, content(selection.partition)),
    draft: (selection) => build(selection, draftTicketContent()),
    snapshot: merged,
  };
}
