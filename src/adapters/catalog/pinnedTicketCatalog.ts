import { ContentRef } from "../../domain/chuggernaut/task.js";
import { ticketCatalog } from "./ticketCatalog.ts";
import { mergedTicketCatalogSnapshot } from "./mergedTicketCatalog.ts";
import { projectTicketCatalogSource } from "./projectCatalog.ts";
import type {
  PinnedTicketCatalogSelection,
  PinnedTicketCatalogs,
} from "../../interpreter/ticketApplication.ts";
import {
  ticketCatalogFinalizersDirectory,
  type TicketCatalog,
  type TicketCatalogDeclarations,
  type TicketCatalogFragments,
  type TicketCatalogSnapshotPort,
  type TicketCatalogSnapshotRead,
  type TicketContentStore,
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
  /**
   * The merged view read as a roster rather than as files: the project
   * document's own settings, and the finalizers a ticket here may name. The
   * finalizer references are taken from the entries rather than by listing the
   * directory, so a runtime fragment counts exactly as a committed one does.
   */
  const declarations = async (
    selection: PinnedTicketCatalogSelection,
  ): Promise<TicketCatalogDeclarations | undefined> => {
    const view = await merged(selection);
    if (view === undefined) return undefined;
    const source = await projectTicketCatalogSource(
      view.snapshot,
      view.repository,
    );
    const directory = `${ticketCatalogFinalizersDirectory}/`;
    const finalizers = (await view.entries())
      .filter((entry) => entry.path.startsWith(directory))
      .map((entry) => entry.path.slice(directory.length))
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    return {
      repository: source.repository,
      reworkLimit: source.reworkLimit,
      ...(source.cloudProject === undefined
        ? {}
        : { cloudProject: source.cloudProject }),
      executionProfiles: [...source.executionProfiles.keys()].sort(
        (left, right) => (left < right ? -1 : left > right ? 1 : 0),
      ),
      finalizers,
    };
  };
  return {
    catalog: (selection) => build(selection, content(selection.partition)),
    draft: (selection) => build(selection, draftTicketContent()),
    snapshot: merged,
    declarations,
    tip: (selection) => snapshots.tip(selection),
  };
}
