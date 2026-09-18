/**
 * One catalog view over two holdings: the pinned repository tree, and the
 * fragments the project holds durably beside it.
 *
 * THE REPOSITORY IS AUTHORITATIVE AND THE DATABASE IS ADDITIVE. A reference the
 * tree holds resolves to the tree, always; a runtime fragment may introduce a
 * reference the tree does not hold and may never shadow one it does. A writer
 * is refused a colliding reference before the row exists, so the ordinary way
 * to reach this rule is never taken.
 *
 * A COLLISION CAN STILL APPEAR AFTERWARDS, because `.chug/` is edited by
 * committers who never saw the fragment. Then the tree wins here too and the
 * row goes inert: it stays, so an operator can see what was written and remove
 * it, and the listing names the reference once, as the tree's. The two
 * alternatives are worse. Letting the row win would make a database write
 * silently redefine a checked-in document — the precise thing being ruled out.
 * Failing the read would make a project's catalog unreadable because somebody
 * committed a file, which punishes the repository for being authoritative.
 *
 * THE TREE'S LISTING IS READ ONCE PER VIEW. Releasing a ticket dereferences
 * every fragment it names, and asking git which references exist per read would
 * multiply one `ls-tree` by the size of the document. The view is built per
 * request and thrown away with it, so the listing it memoizes is as fresh as
 * the pin it was built from.
 */

import {
  ticketCatalogRoot,
  type TicketCatalogEntry,
  type TicketCatalogFragments,
  type TicketCatalogSnapshotRead,
} from "../../interpreter/ticketCatalog.ts";
import type { Partition } from "../../interpreter/projectStore.ts";

/** The authored reference a catalog path names, whichever form the caller used. */
function mergedReference(path: string): string {
  return path.startsWith(ticketCatalogRoot)
    ? path.slice(ticketCatalogRoot.length)
    : path;
}

function mergedOnce<Value>(build: () => Promise<Value>): () => Promise<Value> {
  let held: Promise<Value> | undefined;
  return () => (held ??= build());
}

export function mergedTicketCatalogSnapshot(
  pinned: TicketCatalogSnapshotRead,
  fragments: TicketCatalogFragments,
  partition: Partition,
): TicketCatalogSnapshotRead {
  const held = mergedOnce(async () => await pinned.entries());
  const committed = mergedOnce(
    async () => new Set((await held()).map((entry) => entry.path)),
  );
  return {
    repository: pinned.repository,
    entries: async (): Promise<readonly TicketCatalogEntry[]> => {
      const shadowing = await committed();
      const runtime = (await fragments.paths(partition)).filter(
        (path) => !shadowing.has(path),
      );
      return [
        ...(await held()),
        ...runtime.map((path) => ({ path, origin: "Runtime" as const })),
      ];
    },
    snapshot: {
      read: async (path) => {
        const reference = mergedReference(path);
        if ((await committed()).has(reference))
          return pinned.snapshot.read(path);
        const stored = await fragments.read(partition, reference);
        /** An absent fragment is the tree's own absence to report, not a second one. */
        return stored ?? (await pinned.snapshot.read(path));
      },
    },
  };
}
