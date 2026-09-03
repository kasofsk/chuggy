/**
 * Every project's inquiry box, held for the life of this tab.
 *
 * IT IS A MODULE'S AND NOT A SCREEN'S BECAUSE THE PAIR IS A DE-DUPLICATION
 * TOKEN. The pair in an ask's body is the whole of what makes a re-send the
 * retry the door is idempotent on — this being the one write with no
 * idempotency key — so a token destroyed by a navigation does not do the one
 * job it exists for: a send that did not land, a click on another screen and a
 * click back would open a second fork for one question and spend the second of
 * the asker's two. Held in a component, every boundary the reader crosses is
 * another way to lose it, and the lead page is a sibling of every other screen
 * in the project.
 *
 * IT IS NOT PERSISTED. A pair outliving the tab is a pair the door may have
 * taken with no answer this console ever saw, and re-sending it later would ask
 * about a fork the reader has forgotten; the session it can be reconciled
 * within is this one.
 *
 * NOTHING CLEARS IT BUT AN ACCEPTED SEND OR AN EXPLICIT DISCARD, so a case
 * discards it rather than relying on a fresh module per case, and a reader's
 * box is theirs until the door takes it.
 */

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { inquiryBoxOf, inquiryBoxWith } from "../../core/leadInquiries.ts";
import type { InquiryBox, InquiryBoxes } from "../../core/leadInquiries.ts";

export interface InquiryBoxStore {
  /** One value per change, so a reader of it may cache on identity. */
  readonly boxes: () => InquiryBoxes;
  readonly write: (
    at: PartitionIdentity,
    next: (box: InquiryBox) => InquiryBox,
  ) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Whether a project has a press outstanding, taken and released by the press
   * itself: two presses inside one render read one render, so what says a press
   * is out cannot be the drawn state.
   */
  readonly outstanding: {
    readonly taken: (name: string) => boolean;
    readonly take: (name: string) => void;
    readonly release: (name: string) => void;
  };
  /** Everything forgotten. Nothing in the console calls this; a case does. */
  readonly discard: () => void;
}

export function inquiryBoxStore(): InquiryBoxStore {
  let boxes: InquiryBoxes = {};
  const outstanding = new Set<string>();
  const listeners = new Set<() => void>();
  const told = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    boxes: () => boxes,
    write: (at, next) => {
      boxes = inquiryBoxWith(boxes, at, next(inquiryBoxOf(boxes, at)));
      told();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    outstanding: {
      taken: (name) => outstanding.has(name),
      take: (name) => outstanding.add(name),
      release: (name) => outstanding.delete(name),
    },
    discard: () => {
      boxes = {};
      outstanding.clear();
      told();
    },
  };
}

/** The one this tab uses, named so a case can discard it between runs. */
export const inquiryBoxesHeld = inquiryBoxStore();
