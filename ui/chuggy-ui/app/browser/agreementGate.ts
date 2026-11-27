/**
 * The agreement gate, held for the life of the store, so the standing read at
 * sign-in is read once however often what draws it is drawn again. What each
 * answer means is `core/agreementGate.ts`'s; what is here is only the order of
 * the requests a read and a press make.
 *
 * NOTHING HERE IS A CONSOLE QUERY. The standing is read when the session is
 * first signed in where the deployment asks, again by a press, again after a
 * send the plane refused as changed, and again when an answer refusing the
 * person for want of agreement is heard while the gate is passed, and never on
 * focus or on a renewal of the session. Both doors to the API tell this gate:
 * the store's own ports, joined by `consoleStoreJoined`, and the screens',
 * through `AgreementRequiredHeard`.
 *
 * The page takes the router's place, so the router mounts again once the gate
 * passes, and the cache reads again on that mount every read that failed. A
 * write the API refused is not sent again.
 */

import { createSlice } from "@reduxjs/toolkit";
import { createContext } from "react";
import type {
  PayloadAction,
  ThunkAction,
  UnknownAction,
} from "@reduxjs/toolkit";

import {
  agreementAnswered,
  agreementGateOpened,
  agreementGateUnread,
  agreementHeard,
  agreementHeardAnswered,
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

/** What tells the store's gate of an answer refusing for want of agreement,
 * for the ports the screens make; absent where no store is joined. */
export const AgreementRequiredHeard = createContext<(() => void) | undefined>(
  undefined,
);

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

/** The gate as a signed-in root opens it: the first read where the deployment
 * asks, and a pass with no read where it does not. */
export function agreementGateOpen(
  asked: boolean,
): AgreementGateThunk<Promise<void>> {
  return async (dispatch, getState) => {
    if (asked) {
      await dispatch(agreementStandingRead("First"));
      return;
    }
    dispatch(
      agreementGateMoved(agreementGateOpened(getState().agreementGate, false)),
    );
  };
}

/** An answer refusing for want of agreement, heard: the standing read again
 * once however many are heard while it is unanswered, under the router. */
export function agreementRequiredHeard(): AgreementGateThunk<Promise<void>> {
  return async (dispatch, getState, extra) => {
    const passed = agreementHeard(getState().agreementGate);
    if (passed === undefined) return;
    dispatch(agreementGateMoved(passed));
    const read = await apiAgreementStanding(extra.ports);
    dispatch(agreementGateMoved(agreementHeardAnswered(passed, read)));
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
