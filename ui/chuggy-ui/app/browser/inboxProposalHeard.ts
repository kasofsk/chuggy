/**
 * The answer line of each drawn inbox, held in the console's store so that a
 * review's write reports into it whether or not the row that pressed is still
 * drawn. What each action does to a record is `core/inboxProposals.ts`'s.
 */

import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  inboxProposalDrawn,
  inboxProposalHeardOf,
  inboxProposalHeardWith,
  inboxProposalLeft,
} from "../core/inboxProposals.ts";
import type {
  InboxProposalAnswer,
  InboxProposalHeards,
} from "../core/inboxProposals.ts";

const inboxProposalHeardsEmpty: InboxProposalHeards = {};

export const inboxProposalHeard = createSlice({
  name: "inboxProposalHeard",
  initialState: inboxProposalHeardsEmpty,
  reducers: {
    inboxProposalDrawnAt: (heards, action: PayloadAction<PartitionIdentity>) =>
      inboxProposalDrawn(heards, action.payload),
    inboxProposalLeftAt: (heards, action: PayloadAction<PartitionIdentity>) =>
      inboxProposalLeft(heards, action.payload),
    inboxProposalHeardAt: (
      heards,
      action: PayloadAction<{
        readonly partition: PartitionIdentity;
        readonly answer: InboxProposalAnswer;
      }>,
    ) =>
      inboxProposalHeardWith(
        heards,
        action.payload.partition,
        action.payload.answer,
      ),
  },
  selectors: {
    inboxProposalLastAt: (heards, partition: PartitionIdentity) =>
      inboxProposalHeardOf(heards, partition).last,
  },
});

export const {
  inboxProposalDrawnAt,
  inboxProposalLeftAt,
  inboxProposalHeardAt,
} = inboxProposalHeard.actions;

export const { inboxProposalLastAt } = inboxProposalHeard.selectors;
