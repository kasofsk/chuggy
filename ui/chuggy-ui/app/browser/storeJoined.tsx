/**
 * The console's store joined to the agreement gate at both doors to the API:
 * its own ports, which it is made over and so cannot be handed its dispatch,
 * tell the gate through the store once it is made, which is before any
 * request is sent; and the ports
 * the screens make reach the same gate through `AgreementRequiredHeard`, which
 * the provider here supplies. `main.tsx` mounts the console through these, and
 * a case that hears a refusal at either door mounts through the same.
 */

import type { ReactNode } from "react";
import { Provider } from "react-redux";

import {
  AgreementRequiredHeard,
  agreementRequiredHeard,
} from "./agreementGate.ts";
import { consoleStore } from "./store.ts";
import type { ConsoleStore } from "./store.ts";
import type { ConsoleServices } from "./storeExtra.ts";

export interface ConsoleStoreJoined {
  readonly store: ConsoleStore;
  readonly agreementRequired: () => void;
}

/** A store over `services`, its ports telling its own agreement gate. */
export function consoleStoreJoined(
  services: ConsoleServices,
): ConsoleStoreJoined {
  const agreementRequired = (): void => {
    void store.dispatch(agreementRequiredHeard());
  };
  const store: ConsoleStore = consoleStore({
    ...services,
    ports: { ...services.ports, agreementRequired },
  });
  return { store, agreementRequired };
}

/** The joined store provided, and what tells its gate with it. */
export function ConsoleStoreJoinedProvider(props: {
  readonly joined: ConsoleStoreJoined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Provider store={props.joined.store}>
      <AgreementRequiredHeard.Provider value={props.joined.agreementRequired}>
        {props.children}
      </AgreementRequiredHeard.Provider>
    </Provider>
  );
}
