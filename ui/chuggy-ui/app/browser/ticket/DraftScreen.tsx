/**
 * The frame of a screen that writes a ticket's draft, which a new ticket, a
 * duplicate and an edit all are: its title in the bar, and its Draft panel
 * for a reader who may write one.
 *
 * A reader who may not mutate is refused what the form reads to offer its
 * fields, so the form is not mounted to find that out. The panel says it is
 * loading until the abilities read settles, and that the reader may only view
 * where that read said no.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useProjectAbilityRead, ViewOnlyNotice } from "../projectAbilities.tsx";
import { TopBarSlot } from "../shell/slots.tsx";
import { Panel } from "../ui/Panel.tsx";

export function DraftScreen(props: {
  readonly partition: PartitionIdentity;
  readonly heading: ReactNode;
  /** The Draft panel and the reads behind it. */
  readonly children: ReactNode;
}): ReactNode {
  const read = useProjectAbilityRead(props.partition, "mutate");
  return (
    <>
      <TopBarSlot>
        <h1 className="text-md font-strong text-ink-1 truncate">
          {props.heading}
        </h1>
      </TopBarSlot>
      {read === "Asked" ? (
        props.children
      ) : (
        <Panel title="Draft">
          {read === "Refused" ? (
            <ViewOnlyNotice />
          ) : (
            <PanelUnready state={{ state: "Pending" }} />
          )}
        </Panel>
      )}
    </>
  );
}
