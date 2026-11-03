/**
 * NAMED CASES PIN PATHS AND A WALK PINS EVERY PATH BETWEEN THEM. The reader's
 * moves are drawn at random from those the frame offers, made by the controls
 * a reader uses, and after each one the frame is held to the trail: which
 * panels it draws, the pane's presentation and stored state, and its share as
 * the edge says it.
 *
 * Each seed is its own file, so the walks run beside one another.
 */

import { cleanup, screen } from "@testing-library/react";
import { expect } from "vitest";

import {
  chatPanePanels,
  chatPanePlacements,
  chatPaneShareText,
  chatPaneStoreKey,
  chatPaneTrailAxisEm,
  chatPaneTrailDrawn,
  chatPaneTrailHeld,
  chatPaneTrailMoved,
  chatPaneTrailOffered,
  chatPaneTrailStarted,
} from "../app/core/chatPane.ts";
import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type {
  ChatPaneMove,
  ChatPaneOrientation,
  ChatPaneTrail,
  ChatPaneTrailFrame,
} from "../app/core/chatPane.ts";
import { seededRandom } from "./seededRandom.ts";
import {
  chatDrawn,
  edgePulled,
  edgeShare,
  edgeText,
  frameDivided,
  frameTallEm,
  mounted,
  panePlaced,
  pressed,
  stripShare,
} from "./shellFrame.tsx";
import { atlas } from "./shellRouter.tsx";
import { threadMineSession } from "./threadFixture.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import type { ViewportFrame } from "./viewport.ts";
import { viewportTwoColumnEm } from "../app/browser/shell/viewport.ts";

/** The frame a walk starts in: a desk's width, one too narrow to divide that
 * still keeps the bar, and a desk's height. */
export const walkFrame: ChatPaneTrailFrame = {
  wideEm: viewportDeskEm,
  narrowEm: viewportTwoColumnEm - 10,
  heightEm: frameTallEm,
};

/** The shares a walk drags the pane to along each axis: open ones, one past
 * the most, and none, which is the strip; under the pages, one just over the
 * least. */
export const walkShares: Readonly<
  Record<ChatPaneOrientation, readonly number[]>
> = {
  horizontal: [30, 40, 50, 60, 70, 95, 0],
  vertical: [35, 40, 55, 60, 70, 80, 96, 0],
};

/** How short and how tall a walk draws the frame: short enough that the strip
 * under the pages is over the pane's least, and taller than a desk. */
export const walkHeightLeastEm = 5;
export const walkHeightMostEm = 90;
export const walkHeightSteps = 48;

/** The heights a walk draws the frame at, as many in each doubling and on
 * quarters of an `em`, so a frame a few strips tall is drawn as often as a
 * desk's. It leaves out a height at which the strip is as tall as a share the
 * walk drags the pane open to, since the library tells the strip by its size
 * alone and a reader never lands an edge on it to the pixel. */
export const walkHeightsEm: readonly number[] = [
  ...new Set(
    Array.from({ length: walkHeightSteps + 1 }, (_, step) => {
      const ratio = walkHeightMostEm / walkHeightLeastEm;
      const heightEm = walkHeightLeastEm * ratio ** (step / walkHeightSteps);
      return Math.round(heightEm * 4) / 4;
    }),
  ),
].filter((heightEm) =>
  walkShares.vertical.every(
    (share) => Math.abs(stripShare(heightEm) - share) > 0.001,
  ),
);

export type WalkMounted = Awaited<ReturnType<typeof mounted>>;

/** The viewport a trail's frame is drawn in. */
export function walkViewport(
  trail: ChatPaneTrail,
): readonly [number, ViewportFrame] {
  return [
    chatPaneTrailAxisEm(trail, "horizontal"),
    { heightEm: chatPaneTrailAxisEm(trail, "vertical") },
  ];
}

export function walkMounted(trail: ChatPaneTrail): Promise<WalkMounted> {
  const [em, frame] = walkViewport(trail);
  return mounted(em, undefined, undefined, frame);
}

export function walkPicked<T>(among: readonly T[], random: () => number): T {
  const picked = among[Math.floor(random() * among.length)];
  if (picked === undefined) throw new Error("a walk picked among nothing");
  return picked;
}

/** The move a walk makes next, among those the frame offers. */
export function walkMove(
  trail: ChatPaneTrail,
  random: () => number,
): ChatPaneMove {
  const drawn = chatPaneTrailDrawn(trail);
  const move = walkPicked(chatPaneTrailOffered(trail), random);
  if (move === "Placed") {
    const held = chatPaneTrailHeld(trail).placement;
    const others = chatPanePlacements.filter((placement) => placement !== held);
    return { move, placement: walkPicked(others, random) };
  }
  if (move === "Dragged") {
    const shares = walkShares[drawn.orientation].filter(
      (share) => share !== drawn.share,
    );
    return { move, share: walkPicked(shares, random) };
  }
  if (move === "Resized") {
    const heights = walkHeightsEm.filter(
      (heightEm) => heightEm !== trail.heightEm,
    );
    return { move, heightEm: walkPicked(heights, random) };
  }
  return { move };
}

/** The edge dragged until the pane takes this share of the frame along its
 * axis, from the share the trail says it takes now. */
export async function walkDragged(
  trail: ChatPaneTrail,
  share: number,
): Promise<void> {
  const drawn = chatPaneTrailDrawn(trail);
  const vertical = drawn.orientation === "vertical";
  const axisEm = chatPaneTrailAxisEm(trail, drawn.orientation);
  const toward = drawn.panels[0] === chatPanePanels.pages ? -1 : 1;
  const by = ((share - (drawn.share ?? 0)) / 100) * axisEm * 16;
  await edgePulled(by * toward, vertical);
}

/** Where a walk's route is set, which is the file's own double of the router. */
let routeSet: (
  params: PartitionIdentity & { readonly session?: string },
) => void = () => undefined;

export function walkRouted(set: typeof routeSet): void {
  routeSet = set;
}

/** A trip to a thread's own page and back. */
export async function walkVisited(frame: WalkMounted): Promise<void> {
  routeSet({ ...atlas, session: threadMineSession });
  await frame.redrawn();
  routeSet(atlas);
  await frame.redrawn();
}

/** The window resized to the frame a trail is drawn in. */
export async function walkResized(
  trail: ChatPaneTrail,
  frame: WalkMounted,
): Promise<WalkMounted> {
  viewportAtEm(...walkViewport(trail));
  await frame.redrawn();
  return frame;
}

/** The move made on the mounted frame, by the control a reader would use. */
export async function walkApplied(
  move: ChatPaneMove,
  trail: ChatPaneTrail,
  frame: WalkMounted,
): Promise<WalkMounted> {
  switch (move.move) {
    case "Placed":
      await panePlaced(move.placement);
      return frame;
    case "Collapsed":
      await pressed("Collapse");
      return frame;
    case "Expanded":
      await pressed("Expand chat");
      return frame;
    case "Filled":
      await pressed("Full screen");
      return frame;
    case "Restored":
      await pressed("Exit full screen");
      return frame;
    case "Narrowed":
    case "Widened":
    case "Resized":
      return walkResized(chatPaneTrailMoved(trail, move), frame);
    case "Visited":
      await walkVisited(frame);
      return frame;
    case "Reloaded":
      cleanup();
      return walkMounted(trail);
    case "Dragged":
      await walkDragged(trail, move.share);
      return frame;
  }
}

/** The frame as the trail says it is drawn: its panels and axis, the pane's
 * presentation and stored state, and the pane's share as the edge's value and
 * its text say it. */
export function walkChecked(trail: ChatPaneTrail, where: string): void {
  const drawn = chatPaneTrailDrawn(trail);
  const axis = drawn.orientation === "vertical" ? "down" : "across";
  expect(frameDivided(), where).toBe(`${axis} ${drawn.panels.join(" | ")}`);
  const strip = drawn.state.presentation === "Collapsed";
  expect(chatDrawn() === null, where).toBe(strip);
  expect(
    screen.queryByRole("button", { name: "Expand chat" }) !== null,
    where,
  ).toBe(strip);
  expect(localStorage.getItem(chatPaneStoreKey), where).toBe(
    trail.hold.stored === undefined ? null : JSON.stringify(trail.hold.stored),
  );
  if (drawn.share === undefined) {
    expect(screen.queryByRole("separator"), where).toBeNull();
    return;
  }
  const before = edgeShare();
  const seen = drawn.panels[0] === chatPanePanels.pages ? 100 - before : before;
  expect(seen, where).toBeCloseTo(drawn.share, 2);
  expect(edgeText(), where).toBe(chatPaneShareText(drawn.share));
}

/** The moves made one after another from a fresh frame, the frame checked
 * against the trail after each. */
export async function walkReplayed(
  moves: readonly ChatPaneMove[],
  where: string,
): Promise<void> {
  let trail = chatPaneTrailStarted(walkFrame);
  let frame = await walkMounted(trail);
  walkChecked(trail, `${where}, at the start`);
  for (const [step, move] of moves.entries()) {
    frame = await walkApplied(move, trail, frame);
    trail = chatPaneTrailMoved(trail, move);
    walkChecked(
      trail,
      `${where}, step ${String(step)}: ${JSON.stringify(move)}`,
    );
  }
}

/** How many walks are taken, how far each goes, and how long one may take. */
export const walkStepsMax = 300;
export const walkTimeoutMs = 120_000;

/** The moves a seed draws, which are the whole of what its walk does, so a
 * walk that fails is taken again from its seed alone. */
export function walkDrawn(seed: number): readonly ChatPaneMove[] {
  const random = seededRandom(seed);
  let trail = chatPaneTrailStarted(walkFrame);
  const moves: ChatPaneMove[] = [];
  for (let step = 0; step < walkStepsMax; step += 1) {
    const move = walkMove(trail, random);
    moves.push(move);
    trail = chatPaneTrailMoved(trail, move);
  }
  return moves;
}
