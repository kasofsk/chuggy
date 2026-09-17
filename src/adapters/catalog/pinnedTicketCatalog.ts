import { ticketCatalog } from "./ticketCatalog.ts";
import { projectTicketCatalogSource } from "./projectCatalog.ts";
import type { PinnedTicketCatalogs } from "../../interpreter/ticketApplication.ts";
import type {
  TicketCatalogSnapshotPort,
  TicketContentStore,
} from "../../interpreter/ticketCatalog.ts";
import type { Partition } from "../../interpreter/projectStore.ts";

/** Builds each authoring catalog from one commit-pinned repository snapshot. */
export function pinnedTicketCatalogs(
  snapshots: TicketCatalogSnapshotPort,
  content: (partition: Partition) => TicketContentStore,
): PinnedTicketCatalogs {
  return {
    catalog: async (input) => {
      const pinned = await snapshots.snapshot(input);
      if (pinned === undefined) return undefined;
      const source = await projectTicketCatalogSource(
        pinned.snapshot,
        pinned.repository,
      );
      return ticketCatalog(source, content(input.partition));
    },
  };
}
