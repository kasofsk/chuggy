/**
 * The two journal instants every ticket body carries, stated once because every
 * suite that builds one needs them and none of them is about either. They
 * differ from each other so a body that swapped them would not still pass.
 */
export const ticketInstants = {
  releasedAt: "2026-08-26T00:00:00Z",
  changedAt: "2026-08-27T00:00:00Z",
};
