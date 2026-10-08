/**
 * One level's permissions as one card: a row a permission, and in each row
 * every holder as a chip, in the order the rows give them, or `Nobody`.
 *
 * It reads nothing, sends nothing and is given no workspace, so any level's
 * page draws its list with it, ready or not: a list the reader is not answered
 * is the one line its page gives, and a cut one says so under the table. Each
 * holder a route removes from a permission the reader may change ends in a
 * remove button, and what pressing it does is the removal's: the card only
 * holds the one question a removal of a permission manager asks first, and the
 * one line a refusal leaves in its row. Each permission the reader may change
 * ends in `Add`, offering what the addition says the row offers.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { ApiResult } from "../../core/apiRequest.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  permissionHolderRemovable,
  permissionPersonMarks,
  permissionRemovalAsks,
  permissionRemovalQuestion,
  permissionsNobody,
  type PermissionAuthority,
  type PermissionHolder,
  type PermissionRow,
} from "../../core/permissions.ts";
import {
  accessFailureLabel,
  tenantPeopleTruncated,
} from "../../core/tenantPeople.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Chip } from "../ui/Chip.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Table } from "../ui/Table.tsx";
import {
  PermissionAddition,
  PermissionPersonName,
  type PermissionsAddition,
} from "./PermissionAddition.tsx";

import "./permissions.css";

/** Whether a row's holders may be removed, and what removing one does. */
export interface PermissionsRemoval<Authority extends PermissionAuthority> {
  readonly removable: (row: PermissionRow<Authority>) => boolean;
  readonly remove: (
    row: PermissionRow<Authority>,
    holder: PermissionHolder,
  ) => Promise<ApiResult<undefined>>;
}

interface PermissionRemovalPressed<Authority extends PermissionAuthority> {
  readonly row: PermissionRow<Authority>;
  readonly holder: PermissionHolder;
}

/** One removal at a time in a card, from the press to the line it leaves. */
interface PermissionsRemovalState<Authority extends PermissionAuthority> {
  readonly busy: boolean;
  readonly note:
    { readonly authority: Authority; readonly words: string } | undefined;
  readonly asking: PermissionRemovalPressed<Authority> | undefined;
  readonly press: (pressed: PermissionRemovalPressed<Authority>) => void;
  readonly send: (pressed: PermissionRemovalPressed<Authority>) => void;
  readonly cancel: () => void;
}

function usePermissionsSectionRemoval<Authority extends PermissionAuthority>(
  removal: PermissionsRemoval<Authority>,
): PermissionsRemovalState<Authority> {
  const [busy, setBusy] = useState(false);
  const [note, setNote] =
    useState<PermissionsRemovalState<Authority>["note"]>(undefined);
  const [asking, setAsking] = useState<
    PermissionRemovalPressed<Authority> | undefined
  >(undefined);
  const send = (pressed: PermissionRemovalPressed<Authority>): void => {
    setBusy(true);
    setNote(undefined);
    void (async () => {
      const answered = await removal.remove(pressed.row, pressed.holder);
      setAsking(undefined);
      setBusy(false);
      setNote(
        answered.outcome === "Ok"
          ? undefined
          : {
              authority: pressed.row.authority,
              words: accessFailureLabel(answered),
            },
      );
    })();
  };
  return {
    busy,
    note,
    asking,
    send,
    press: (pressed) => {
      if (permissionRemovalAsks(pressed.row)) setAsking(pressed);
      else send(pressed);
    },
    cancel: () => {
      setAsking(undefined);
    },
  };
}

function permissionHolderKey(holder: PermissionHolder): string {
  switch (holder.kind) {
    case "Person":
      return `Person:${holder.person.subject}`;
    case "SiteStanding":
    case "Group":
    case "TenantAdmins":
    case "Unnamed":
      return `${holder.kind}:${holder.words}`;
  }
}

/** A holder's words as its chip draws them, a person's standing quiet after
 * their name. */
function PermissionHolderWords(props: {
  readonly holder: PermissionHolder;
}): ReactNode {
  const holder = props.holder;
  if (holder.kind !== "Person") return holder.words;
  return (
    <>
      <PermissionPersonName person={holder.person} />
      {permissionPersonMarks(holder.person).map((mark) => (
        <span key={mark} className="text-ink-3">
          {` ${mark}`}
        </span>
      ))}
    </>
  );
}

function PermissionHolderItem(props: {
  readonly holder: PermissionHolder;
  readonly permission: string;
  readonly removable: boolean;
  readonly busy: boolean;
  readonly onRemove: () => void;
}): ReactNode {
  const holder = props.holder;
  return (
    <li className="flex max-w-full min-w-0">
      <Chip
        removal={
          props.removable
            ? {
                name: `Remove ${holder.words} from ${props.permission}`,
                disabled: props.busy,
                onRemove: props.onRemove,
              }
            : undefined
        }
      >
        <PermissionHolderWords holder={holder} />
      </Chip>
    </li>
  );
}

/** Under a permission's holders: the line a refused removal left, and the
 * question a removal asked first waits on. */
function PermissionRowAsked<Authority extends PermissionAuthority>(props: {
  readonly row: PermissionRow<Authority>;
  readonly removing: PermissionsRemovalState<Authority>;
}): ReactNode {
  const removing = props.removing;
  const asking = removing.asking;
  const note = removing.note;
  return (
    <>
      {note === undefined || note.authority !== props.row.authority ? null : (
        <Notice tone="danger" inline role="status" detail={note.words} />
      )}
      {asking?.row.authority !== props.row.authority ? null : (
        <div className="max-w-aside">
          <Confirm
            question={permissionRemovalQuestion.question}
            confirm="Remove"
            busy={removing.busy}
            onConfirm={() => {
              removing.send(asking);
            }}
            onCancel={removing.cancel}
          >
            {permissionRemovalQuestion.line}
          </Confirm>
        </div>
      )}
    </>
  );
}

function PermissionRowDrawn<Authority extends PermissionAuthority>(props: {
  readonly row: PermissionRow<Authority>;
  readonly removable: boolean;
  readonly removing: PermissionsRemovalState<Authority>;
  readonly addition: PermissionsAddition<Authority>;
}): ReactNode {
  const row = props.row;
  const removing = props.removing;
  return (
    <tr>
      <th scope="row">{row.name}</th>
      <td>
        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {row.holders.length === 0 ? (
              <span className="text-ink-3">{permissionsNobody}</span>
            ) : (
              <ul className="contents">
                {row.holders.map((holder) => (
                  <PermissionHolderItem
                    key={permissionHolderKey(holder)}
                    holder={holder}
                    permission={row.name}
                    removable={
                      props.removable && permissionHolderRemovable(row, holder)
                    }
                    busy={removing.busy || removing.asking !== undefined}
                    onRemove={() => {
                      removing.press({ row, holder });
                    }}
                  />
                ))}
              </ul>
            )}
            {props.addition.addable(row) ? (
              <span className="permissions-add">
                <PermissionAddition row={row} addition={props.addition} />
              </span>
            ) : null}
          </div>
          <PermissionRowAsked row={row} removing={removing} />
        </div>
      </td>
    </tr>
  );
}

function PermissionsTable<Authority extends PermissionAuthority>(props: {
  readonly label: string;
  readonly rows: readonly PermissionRow<Authority>[];
  readonly removal: PermissionsRemoval<Authority>;
  readonly removing: PermissionsRemovalState<Authority>;
  readonly addition: PermissionsAddition<Authority>;
}): ReactNode {
  return (
    <Table caption={props.label}>
      <thead>
        <tr>
          <th scope="col" className="permissions-name">
            Permission
          </th>
          <th scope="col">Held by</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <PermissionRowDrawn
            key={row.authority}
            row={row}
            removable={props.removal.removable(row)}
            removing={props.removing}
            addition={props.addition}
          />
        ))}
      </tbody>
    </Table>
  );
}

/** What the card says besides its table, where it says anything: a list not
 * read yet, one the reader is not answered, or one cut short. */
function permissionsLine(
  read: PanelState<{ readonly truncated: boolean }>,
  withheld: string,
): ReactNode {
  switch (read.state) {
    case "Ready":
      return read.value.truncated ? (
        <Notice tone="parked" inline detail={tenantPeopleTruncated} />
      ) : undefined;
    case "Absent":
      return <Notice tone="parked" inline detail={withheld} />;
    case "Pending":
    case "Failed":
      return <PanelUnready state={read} />;
  }
}

export function PermissionsSection<
  Authority extends PermissionAuthority,
  Answer extends { readonly truncated: boolean },
>(props: {
  /** What the card and its table are named for a reader who sees neither. */
  readonly label: string;
  readonly read: PanelState<Answer>;
  readonly rows: (answer: Answer) => readonly PermissionRow<Authority>[];
  /** The one line for a reader the level's list is not answered to. */
  readonly withheld: string;
  readonly removal: PermissionsRemoval<Authority>;
  readonly addition: PermissionsAddition<Authority>;
}): ReactNode {
  const read = props.read;
  const removing = usePermissionsSectionRemoval(props.removal);
  const line = permissionsLine(read, props.withheld);
  return (
    <section
      aria-label={props.label}
      className="permissions bg-surface-1 border-edge rounded-2 min-w-0 border"
    >
      {read.state === "Ready" ? (
        <PermissionsTable
          label={props.label}
          rows={props.rows(read.value)}
          removal={props.removal}
          removing={removing}
          addition={props.addition}
        />
      ) : null}
      {line === undefined ? null : (
        <div className="permissions-line">{line}</div>
      )}
    </section>
  );
}
