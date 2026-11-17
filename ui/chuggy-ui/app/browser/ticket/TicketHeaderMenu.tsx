/**
 * The header's ⋯ menu, drawn through `MoreMenu`: whatever the header does not
 * lead with, as the caller hands it, then Duplicate where it is not the
 * header's main action, Copy link, which stays open to say it copied, and the
 * destructive Revoke and a draft's Delete, each asking before it submits.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { consolePageHref } from "../../core/consolePage.ts";
import type { TicketAction } from "../../core/ticketActions.ts";
import { currentOrigin } from "../ports.ts";
import { CopySaid, useCopyPress } from "../ui/CopyButton.tsx";
import type { CopyPress } from "../ui/CopyButton.tsx";
import { MoreMenu } from "../ui/MoreMenu.tsx";
import type { MoreMenuItem } from "../ui/MoreMenu.tsx";
import { TicketActionConfirm } from "./TicketActionConfirm.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";

interface TicketHeaderMenuProps {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  /** The entries the menu opens with: what the header offers beside its
   * primary action. */
  readonly leading?: readonly MoreMenuItem[];
  readonly revoke: TicketAction | undefined;
  readonly duplicate: boolean;
  readonly busy: boolean;
  readonly onChoose: (action: TicketAction) => void;
  /** Deletes the draft, where the menu offers it. */
  readonly onDelete?: (() => void) | undefined;
}

function ticketHeaderMenuCopyItem(
  props: TicketHeaderMenuProps,
  copy: CopyPress,
  text: CopyText,
): MoreMenuItem {
  return {
    kind: "action",
    label: text({
      id: copy.copied ? "ticket-copy-link-copied" : "ticket-copy-link",
    }),
    onSelect: (event) => {
      event.preventDefault();
      copy.press(
        new URL(
          consolePageHref(props.partition, {
            page: "Ticket",
            ticket: props.ticket,
          }),
          currentOrigin(),
        ).href,
      );
    },
  };
}

function ticketHeaderMenuItems(
  props: TicketHeaderMenuProps,
  copy: CopyPress | undefined,
  text: CopyText,
  asking: { readonly revoke: () => void; readonly delete: () => void },
): readonly MoreMenuItem[] {
  const { partition, ticket } = props;
  return [
    ...(props.leading ?? []),
    ...(props.duplicate
      ? [
          {
            kind: "link",
            label: text({ id: "ticket-duplicate" }),
            link: (anchor) => (
              <Link
                to="/$tenant/$project/tickets/new"
                params={partition}
                search={{ from: ticket }}
                {...anchor}
              />
            ),
          } satisfies MoreMenuItem,
        ]
      : []),
    ...(copy === undefined
      ? []
      : [ticketHeaderMenuCopyItem(props, copy, text)]),
    ...(props.revoke === undefined
      ? []
      : [
          {
            kind: "destructive",
            label: text({ id: "ticket-revoke-menu-item" }),
            disabled: props.busy,
            onSelect: asking.revoke,
          } satisfies MoreMenuItem,
        ]),
    ...(props.onDelete === undefined
      ? []
      : [
          {
            kind: "destructive",
            label: text({ id: "ticket-draft-delete-menu-item" }),
            disabled: props.busy,
            onSelect: asking.delete,
          } satisfies MoreMenuItem,
        ]),
  ];
}

/** The menu, and the questions Revoke and Delete ask; a menu with nothing in
 * it is not drawn. */
export function TicketHeaderMenu(props: TicketHeaderMenuProps): ReactNode {
  const copy = useCopyPress();
  const [revoking, setRevoking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { revoke, onDelete } = props;
  const text = useCopyText();
  const items = ticketHeaderMenuItems(props, copy, text, {
    revoke: () => {
      setRevoking(true);
    },
    delete: () => {
      setDeleting(true);
    },
  });
  if (items.length === 0) return null;
  return (
    <>
      <MoreMenu
        label={text({ id: "ticket-header-menu-label" })}
        items={items}
      />
      {copy === undefined ? null : <CopySaid copied={copy.copied} />}
      {revoke === undefined ? null : (
        <TicketActionConfirm
          title={text({ id: "ticket-revoke-confirm-title" })}
          confirm={text({ id: "ticket-revoke-confirm" })}
          danger
          open={revoking}
          onOpenChange={setRevoking}
          onConfirm={() => {
            props.onChoose(revoke);
          }}
        >
          {text({ id: "ticket-revoke-warning" })}
        </TicketActionConfirm>
      )}
      {onDelete === undefined ? null : (
        <TicketActionConfirm
          title={text({ id: "ticket-draft-delete-confirm-title" })}
          confirm={text({ id: "ticket-draft-delete" })}
          danger
          open={deleting}
          onOpenChange={setDeleting}
          onConfirm={onDelete}
        >
          {text({ id: "ticket-cant-be-undone" })}
        </TicketActionConfirm>
      )}
    </>
  );
}
