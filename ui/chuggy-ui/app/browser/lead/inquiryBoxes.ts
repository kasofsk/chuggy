/**
 * Every project's inquiry box, held in the console's store for the life of the
 * tab.
 *
 * IT IS THE STORE'S AND NOT A SCREEN'S BECAUSE THE PAIR IS A DE-DUPLICATION
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
 * NOTHING CLEARS A BOX BUT AN ACCEPTED SEND, so a reader's box is theirs until
 * the door takes it. What each action does to a box is `core/leadInquiries.ts`'s.
 */

import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import {
  inquiryBoxAnswered,
  inquiryBoxOf,
  inquiryBoxSent,
  inquiryBoxTyped,
  inquiryBoxWith,
} from "../../core/leadInquiries.ts";
import type {
  InquiryAskAnswer,
  InquiryBox,
  InquiryBoxes,
  InquiryDraw,
} from "../../core/leadInquiries.ts";

/** The boxes with one project's written, kept bounded as `inquiryBoxWith` keeps
 * them. */
function inquiryBoxesWritten(
  boxes: InquiryBoxes,
  partition: PartitionIdentity,
  next: (box: InquiryBox) => InquiryBox,
): InquiryBoxes {
  return inquiryBoxWith(boxes, partition, next(inquiryBoxOf(boxes, partition)));
}

const inquiryBoxesEmpty: InquiryBoxes = {};

export const inquiryBoxes = createSlice({
  name: "inquiryBoxes",
  initialState: inquiryBoxesEmpty,
  reducers: {
    inquiryBoxTypedAt: (
      boxes,
      action: PayloadAction<{
        readonly partition: PartitionIdentity;
        readonly typed: string;
      }>,
    ) =>
      inquiryBoxesWritten(boxes, action.payload.partition, (box) =>
        inquiryBoxTyped(box, action.payload.typed),
      ),
    inquiryBoxSentAt: (boxes, action: PayloadAction<InquiryDraw>) =>
      inquiryBoxesWritten(boxes, action.payload.partition, (box) =>
        inquiryBoxSent(box, action.payload),
      ),
    inquiryBoxAnsweredAt: (
      boxes,
      action: PayloadAction<{
        readonly draw: InquiryDraw;
        readonly answer: InquiryAskAnswer;
      }>,
    ) =>
      inquiryBoxesWritten(boxes, action.payload.draw.partition, (box) =>
        inquiryBoxAnswered(box, action.payload.draw, action.payload.answer),
      ),
  },
  selectors: {
    inquiryBoxAt: (boxes, partition: PartitionIdentity) =>
      inquiryBoxOf(boxes, partition),
  },
});

export const { inquiryBoxTypedAt, inquiryBoxSentAt, inquiryBoxAnsweredAt } =
  inquiryBoxes.actions;

export const { inquiryBoxAt } = inquiryBoxes.selectors;
