/**
 * The header's ⋯ menu: Revoke, which asks before it submits, Duplicate where
 * it is not the header's main action, Copy link, which stays open to say it
 * copied, and a draft's Delete, which asks as Revoke does. A menu with nothing
 * in it is not drawn.
 */

import { Link } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { consolePageHref } from "../../core/consolePage.ts";
import type { TicketAction } from "../../core/ticketActions.ts";
import { currentOrigin } from "../ports.ts";
import { buttonLookClassName } from "../ui/Button.tsx";
import { CopySaid, useCopyPress } from "../ui/CopyButton.tsx";
import type { CopyPress } from "../ui/CopyButton.tsx";
import { MenuContent, menuItemClassName } from "../ui/Menu.tsx";
import { TicketActionConfirm } from "./TicketActionConfirm.tsx";

export const ticketHeaderMenuLabel = "More actions";

function TicketHeaderMenuMark(): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4"
      fill="currentColor"
    >
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

interface TicketHeaderMenuProps {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly revoke: TicketAction | undefined;
  readonly duplicate: boolean;
  readonly busy: boolean;
  readonly onChoose: (action: TicketAction) => void;
  /** Deletes the draft, where the menu offers it. */
  readonly onDelete?: (() => void) | undefined;
}

function TicketHeaderMenuItems(
  props: TicketHeaderMenuProps & {
    readonly copy: CopyPress | undefined;
    readonly onRevoking: () => void;
    readonly onDeleting: () => void;
  },
): ReactNode {
  const copy = props.copy;
  return (
    <MenuContent sideOffset={4} align="end">
      {props.revoke === undefined ? null : (
        <DropdownMenu.Item
          className={menuItemClassName}
          disabled={props.busy}
          onSelect={props.onRevoking}
        >
          Revoke…
        </DropdownMenu.Item>
      )}
      {props.duplicate ? (
        <DropdownMenu.Item asChild className={menuItemClassName}>
          <Link
            to="/$tenant/$project/tickets/new"
            params={props.partition}
            search={{ from: props.ticket }}
            className="text-ink-1 no-underline"
          >
            Duplicate
          </Link>
        </DropdownMenu.Item>
      ) : null}
      {copy === undefined ? null : (
        <DropdownMenu.Item
          className={menuItemClassName}
          onSelect={(event) => {
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
          }}
        >
          {copy.copied ? "Copied" : "Copy link"}
        </DropdownMenu.Item>
      )}
      {props.onDelete === undefined ? null : (
        <DropdownMenu.Item
          className={menuItemClassName}
          disabled={props.busy}
          onSelect={props.onDeleting}
        >
          Delete draft…
        </DropdownMenu.Item>
      )}
    </MenuContent>
  );
}

export function TicketHeaderMenu(props: TicketHeaderMenuProps): ReactNode {
  const copy = useCopyPress();
  const [revoking, setRevoking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { revoke, onDelete } = props;
  if (
    revoke === undefined &&
    !props.duplicate &&
    copy === undefined &&
    onDelete === undefined
  )
    return null;
  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          className={buttonLookClassName({ size: "icon" })}
          aria-label={ticketHeaderMenuLabel}
        >
          <TicketHeaderMenuMark />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <TicketHeaderMenuItems
            {...props}
            copy={copy}
            onRevoking={() => {
              setRevoking(true);
            }}
            onDeleting={() => {
              setDeleting(true);
            }}
          />
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {copy === undefined ? null : <CopySaid copied={copy.copied} />}
      {revoke === undefined ? null : (
        <TicketActionConfirm
          title="Revoke this ticket?"
          confirm="Revoke ticket"
          danger
          open={revoking}
          onOpenChange={setRevoking}
          onConfirm={() => {
            props.onChoose(revoke);
          }}
        >
          Ends this ticket and parks its dependents. Can't be undone.
        </TicketActionConfirm>
      )}
      {onDelete === undefined ? null : (
        <TicketActionConfirm
          title="Delete this draft?"
          confirm="Delete draft"
          danger
          open={deleting}
          onOpenChange={setDeleting}
          onConfirm={onDelete}
        >
          Can't be undone.
        </TicketActionConfirm>
      )}
    </>
  );
}
