/**
 * The reader's own threads, bucketed by how long ago each last moved: today,
 * yesterday, the week before that, the month before that, and everything
 * older. The boundaries are calendar days in the reader's own zone, so a
 * thread from yesterday at the day's last minute and one from today at its
 * first still land in different buckets.
 */

export const threadGroupHeadings = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Older",
] as const;

export type ThreadGroupHeading = (typeof threadGroupHeadings)[number];

const msPerDay = 24 * 60 * 60 * 1000;

/** The calendar day a moment falls on, local to the reader, as an integer
 * that steps at midnight rather than drifting with a rolling clock. */
function dayIndex(atMs: number): number {
  const at = new Date(atMs);
  return Math.floor(
    Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / msPerDay,
  );
}

interface ThreadGroupBound {
  readonly heading: ThreadGroupHeading;
  readonly sinceDays: number;
}

/** Every bucket but the last, in the order a day ago is checked against it;
 * a day the last bound does not reach is `Older`. */
const threadGroupBounds: readonly ThreadGroupBound[] = [
  { heading: "Today", sinceDays: 0 },
  { heading: "Yesterday", sinceDays: 1 },
  { heading: "Previous 7 days", sinceDays: 7 },
  { heading: "Previous 30 days", sinceDays: 30 },
];

/** Which bucket one moment falls in, against the day the reader is having. */
export function threadGroupHeading(
  atMs: number,
  nowMs: number,
): ThreadGroupHeading {
  const daysAgo = dayIndex(nowMs) - dayIndex(atMs);
  const bound = threadGroupBounds.find(
    (candidate) => daysAgo <= candidate.sinceDays,
  );
  return bound?.heading ?? "Older";
}

export interface ThreadGroup<T> {
  readonly heading: ThreadGroupHeading;
  readonly entries: readonly T[];
}

/**
 * Every item bucketed by `atMsOf`, in the caller's own order within each
 * bucket and the bucket order the headings are listed in above. A bucket
 * nothing fell into is left out rather than drawn empty.
 */
export function threadGroups<T>(
  items: readonly T[],
  atMsOf: (item: T) => number,
  nowMs: number,
): readonly ThreadGroup<T>[] {
  const byHeading = new Map<ThreadGroupHeading, T[]>();
  for (const item of items) {
    const heading = threadGroupHeading(atMsOf(item), nowMs);
    const held = byHeading.get(heading);
    if (held === undefined) byHeading.set(heading, [item]);
    else held.push(item);
  }
  return threadGroupHeadings.flatMap((heading) => {
    const entries = byHeading.get(heading);
    return entries === undefined ? [] : [{ heading, entries }];
  });
}
