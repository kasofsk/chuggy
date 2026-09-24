/**
 * The fields every ticket body carries regardless of scenario, stated once
 * because every suite that builds one needs them and none of them is about
 * any of these. The two instants differ from each other so a body that
 * swapped them would not still pass; the empty dependency list is what every
 * ticket but a Pending one blocked on a revoked dependency reads.
 */
export const ticketInstants = {
  revision: 1,
  releasedAt: "2026-08-26T00:00:00Z",
  changedAt: "2026-08-27T00:00:00Z",
  revokedDependencies: [],
};
