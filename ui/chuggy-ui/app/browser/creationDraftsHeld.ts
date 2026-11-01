/**
 * The draft each creation form's last submit left held, kept in the console's
 * store so that a reader who leaves the form and comes back still submits to
 * it rather than filing a second draft. What each action does to a record is
 * `core/ticketCreationRun.ts`'s.
 */

import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import {
  creationDraftHeldOf,
  creationDraftsHeldWith,
} from "../core/ticketCreationRun.ts";
import type {
  CreationDraftHeld,
  CreationDraftsHeld,
} from "../core/ticketCreationRun.ts";

const creationDraftsHeldEmpty: CreationDraftsHeld = {};

export const creationDraftsHeld = createSlice({
  name: "creationDraftsHeld",
  initialState: creationDraftsHeldEmpty,
  reducers: {
    creationDraftKeptAt: (
      helds,
      action: PayloadAction<{
        readonly storeKey: string;
        readonly held: CreationDraftHeld | undefined;
      }>,
    ) =>
      creationDraftsHeldWith(
        helds,
        action.payload.storeKey,
        action.payload.held,
      ),
  },
  selectors: {
    creationDraftHeldAt: (helds, storeKey: string) =>
      creationDraftHeldOf(helds, storeKey),
  },
});

export const { creationDraftKeptAt } = creationDraftsHeld.actions;

export const { creationDraftHeldAt } = creationDraftsHeld.selectors;
