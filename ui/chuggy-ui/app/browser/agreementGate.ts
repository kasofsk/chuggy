/**
 * The agreement gate, held for the life of the store, so the standing read at
 * sign-in is read once however often what draws it is drawn again. What each
 * answer means is `core/agreementGate.ts`'s; what is here is only the order of
 * the requests a read and a press make.
 *
 * NOTHING HERE IS A CONSOLE QUERY. The standing is read when the session is
 * first signed in, again by a press, and again after a send the plane refused
 * as changed, and never on focus or on a renewal of the session.
 */

import { createSlice } from "@reduxjs/toolkit";
import type {
  PayloadAction,
  ThunkAction,
  UnknownAction,
} from "@reduxjs/toolkit";

import {
  agreementAnswered,
  agreementGateUnread,
  agreementPending,
  agreementReadable,
  agreementSendable,
  agreementSent,
  agreementStandingGate,
} from "../core/agreementGate.ts";
import type { AgreementGate, AgreementRead } from "../core/agreementGate.ts";
import { apiAgree, apiAgreementStanding } from "../core/agreementRoutes.ts";
import type { ConsoleExtra } from "./storeExtra.ts";

export const agreementGate = createSlice({
  name: "agreementGate",
  initialState: agreementGateUnread,
  reducers: {
    agreementGateMoved: (_gate, action: PayloadAction<AgreementGate>) =>
      action.payload,
  },
  selectors: {
    agreementGateOf: (gate) => gate,
  },
});

const { agreementGateMoved } = agreementGate.actions;

export const { agreementGateOf } = agreementGate.selectors;

type AgreementGateThunk<T> = ThunkAction<
  T,
  { readonly agreementGate: AgreementGate },
  ConsoleExtra,
  UnknownAction
>;

/** The standing read, the first once however often it is asked for, and a
 * retry once while it is unanswered. */
export function agreementStandingRead(
  asked: AgreementRead,
): AgreementGateThunk<Promise<void>> {
  return async (dispatch, getState, extra) => {
    const gate = getState().agreementGate;
    if (!agreementReadable(gate, asked)) return;
    dispatch(agreementGateMoved(agreementPending(gate)));
    const read = await apiAgreementStanding(extra.ports);
    dispatch(agreementGateMoved(agreementStandingGate(read, "None")));
  };
}

/** The policies the page lists agreed to, once however often it is pressed
 * while the send is unanswered. */
export function agreementSend(): AgreementGateThunk<Promise<void>> {
  return async (dispatch, getState, extra) => {
    const gate = getState().agreementGate;
    if (!agreementSendable(gate)) return;
    dispatch(agreementGateMoved(agreementPending(gate)));
    const answer = agreementAnswered(
      gate,
      await apiAgree(extra.ports, agreementSent(gate.policies)),
    );
    if (answer.follows === "Gate") {
      dispatch(agreementGateMoved(answer.gate));
      return;
    }
    const read = await apiAgreementStanding(extra.ports);
    dispatch(agreementGateMoved(agreementStandingGate(read, "Changed")));
  };
}
