/**
 * The ticket page with every tab's body drawn under its header, in the tabs'
 * order, for a suite about what the page draws rather than which address
 * draws it. Which tab draws what is `ticketPageRoutes.test.tsx`'s. Beside
 * it, the header and its menu as a reader reaches them.
 */

import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { TicketPage } from "../app/browser/TicketPage.tsx";
import {
  TicketConfigurationTab,
  TicketOverviewTab,
  TicketRunsTab,
  TicketUsageTab,
} from "../app/browser/ticket/TicketPageTabs.tsx";
import { TicketLandingTab } from "../app/browser/ticket/TicketLandingPage.tsx";
import { TicketRunAt } from "../app/browser/ticket/TicketRunPage.tsx";
import type { TicketRunView } from "../app/core/ticketRuns.ts";
import { turned } from "./screenHarness.tsx";

export function TicketPageEveryTab(): ReactNode {
  return (
    <TicketPage>
      <TicketOverviewTab />
      <TicketRunsTab />
      <TicketConfigurationTab />
      <TicketUsageTab />
    </TicketPage>
  );
}

/** The ticket page at one run's own page, on the sub-tab a case names and at
 * the call it names where it names one. */
export function TicketRunPageAt(props: {
  readonly task: number;
  readonly view?: TicketRunView;
  readonly step?: string;
}): ReactNode {
  const { view, step } = props;
  return (
    <TicketPage>
      <TicketRunAt
        task={props.task}
        asked={{
          ...(view === undefined ? {} : { view }),
          ...(step === undefined ? {} : { step }),
        }}
      />
    </TicketPage>
  );
}

/** The ticket page at its landing's own page. */
export function TicketLandingPageAt(): ReactNode {
  return (
    <TicketPage>
      <TicketLandingTab />
    </TicketPage>
  );
}

/** The page's header, which holds the ticket's actions on every tab. */
export function ticketHeader(): HTMLElement {
  const header = document.querySelector<HTMLElement>("header.ticket-header");
  if (header === null) throw new Error("no ticket header drawn");
  return header;
}

/** The header's ⋯ menu, opened as a keyboard opens it. */
export async function ticketHeaderMenuOpened(): Promise<HTMLElement> {
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), {
      key: "ArrowDown",
    });
  });
  return screen.getByRole("menu");
}
