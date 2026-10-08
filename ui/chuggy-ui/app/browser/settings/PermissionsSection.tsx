/**
 * One level's permissions as a section: a row a permission, and in each row
 * every holder as one item, in the order the rows give them, or `Nobody`.
 *
 * It reads nothing, sends nothing and is given no workspace, so any level's
 * page draws its rows with it. Where it is given a removal, each holder a route
 * removes from a permission the reader may change carries a `Remove` button,
 * and what pressing it does is the removal's: the section only holds the one
 * question a removal of a permission manager asks first, and the one line a
 * refusal leaves in its row. Where it is given an addition, each permission the
 * reader may change carries `Add`, offering what the addition says the row
 * offers. What a section says besides its table is its caller's.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { ApiResult } from "../../core/apiRequest.ts";
import {
  permissionHolderRemovable,
  permissionRemovalAsks,
  permissionRemovalQuestion,
  permissionsNobody,
  type PermissionAuthority,
  type PermissionHolder,
  type PermissionRow,
} from "../../core/permissions.ts";
import { accessFailureLabel } from "../../core/tenantPeople.ts";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Table } from "../ui/Table.tsx";
import {
  PermissionAddition,
  type PermissionsAddition,
} from "./PermissionAddition.tsx";
import { TenantPersonWho } from "./TenantPersonRow.tsx";

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

/** One removal at a time in a section, from the press to the line it leaves. */
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
  removal: PermissionsRemoval<Authority> | undefined,
): PermissionsRemovalState<Authority> {
  const [busy, setBusy] = useState(false);
  const [note, setNote] =
    useState<PermissionsRemovalState<Authority>["note"]>(undefined);
  const [asking, setAsking] = useState<
    PermissionRemovalPressed<Authority> | undefined
  >(undefined);
  const send = (pressed: PermissionRemovalPressed<Authority>): void => {
    if (removal === undefined) return;
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

function PermissionHolderItem(props: {
  readonly holder: PermissionHolder;
  readonly permission: string;
  readonly removable: boolean;
  readonly busy: boolean;
  readonly onRemove: () => void;
}): ReactNode {
  const holder = props.holder;
  return (
    <li className="flex flex-wrap items-center gap-2">
      {holder.kind === "Person" ? (
        <TenantPersonWho person={holder.person} />
      ) : (
        holder.words
      )}
      {props.removable ? (
        <Button
          size="sm"
          variant="quiet"
          disabled={props.busy}
          onClick={props.onRemove}
        >
          Remove{" "}
          <span className="visually-hidden">
            {`${holder.words} from ${props.permission}`}
          </span>
        </Button>
      ) : null}
    </li>
  );
}

/** A permission's name, the line a refused removal left, and the question a
 * removal asked first waits on. */
function PermissionRowHeader<Authority extends PermissionAuthority>(props: {
  readonly row: PermissionRow<Authority>;
  readonly removing: PermissionsRemovalState<Authority>;
}): ReactNode {
  const removing = props.removing;
  const asking = removing.asking;
  const note = removing.note;
  return (
    <th scope="row">
      <span className="grid gap-1">
        {props.row.name}
        {note === undefined || note.authority !== props.row.authority ? null : (
          <Notice tone="danger" inline role="status" detail={note.words} />
        )}
        {asking?.row.authority !== props.row.authority ? null : (
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
        )}
      </span>
    </th>
  );
}

function PermissionRowDrawn<Authority extends PermissionAuthority>(props: {
  readonly row: PermissionRow<Authority>;
  readonly removable: boolean;
  readonly removing: PermissionsRemovalState<Authority>;
  readonly addition: PermissionsAddition<Authority> | undefined;
}): ReactNode {
  const row = props.row;
  const removing = props.removing;
  return (
    <tr>
      <PermissionRowHeader row={row} removing={removing} />
      <td>
        {row.holders.length === 0 ? (
          permissionsNobody
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
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
        {props.addition?.addable(row) === true ? (
          <PermissionAddition row={row} addition={props.addition} />
        ) : null}
      </td>
    </tr>
  );
}

export function PermissionsSection<
  Authority extends PermissionAuthority,
>(props: {
  readonly title: string;
  readonly rows: readonly PermissionRow<Authority>[] | undefined;
  readonly removal?: PermissionsRemoval<Authority>;
  readonly addition?: PermissionsAddition<Authority>;
  readonly children?: ReactNode;
}): ReactNode {
  const removal = props.removal;
  const removing = usePermissionsSectionRemoval(removal);
  return (
    <Panel variant="section" title={props.title}>
      {props.rows === undefined ? null : (
        <Table caption={props.title}>
          <thead>
            <tr>
              <th scope="col">Permission</th>
              <th scope="col">Held by</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <PermissionRowDrawn
                key={row.authority}
                row={row}
                removable={removal?.removable(row) ?? false}
                removing={removing}
                addition={props.addition}
              />
            ))}
          </tbody>
        </Table>
      )}
      {props.children}
    </Panel>
  );
}
