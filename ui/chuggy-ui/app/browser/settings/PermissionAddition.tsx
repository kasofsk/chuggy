/**
 * Adding one holder to one permission: a dialog offering what the row is
 * given, one choice at a time, and for a person a roster of the people given
 * to choose among, one to a line. What adding does is its caller's; the dialog
 * holds the choice, closes on an addition the plane took, and leaves a
 * refusal's one line beside its actions.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { AccessAuthorityPerson } from "../../../../../src/contract/accessPlane.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import {
  permissionChoiceHolder,
  permissionChoiceValue,
  permissionPersonMarks,
  type PermissionAuthority,
  type PermissionChoice,
  type PermissionHolder,
  type PermissionRow,
} from "../../core/permissions.ts";
import { tenantPersonName } from "../../core/tenantPeople.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { SearchableRoster } from "../ui/SearchableRoster.tsx";

/** One press of a row's holder: the row, and the holder it sends. */
export interface PermissionHolderPressed<
  Authority extends PermissionAuthority,
> {
  readonly row: PermissionRow<Authority>;
  readonly holder: PermissionHolder;
}

/** Whether a row may be given a holder, what it offers, the people to choose
 * among, and the write that adds one to it. */
export interface PermissionsAddition<Authority extends PermissionAuthority> {
  readonly addable: (row: PermissionRow<Authority>) => boolean;
  readonly choices: (
    row: PermissionRow<Authority>,
  ) => readonly PermissionChoice[];
  readonly people: (
    row: PermissionRow<Authority>,
  ) => readonly AccessAuthorityPerson[];
  readonly write: (
    row: PermissionRow<Authority>,
  ) => ConsoleWrite<PermissionHolderPressed<Authority>, undefined>;
}

/** A person's name as a permission draws it: their address, or their subject
 * in the face an identity is drawn in. */
export function PermissionPersonName(props: {
  readonly person: AccessAuthorityPerson;
}): ReactNode {
  const named = tenantPersonName(props.person);
  return named.subject ? <code>{named.name}</code> : named.name;
}

/** One person the roster offers on one line: their name and their login,
 * each clipping, then what stands after them and the button that chooses. */
function PermissionAdditionChoice(props: {
  readonly person: AccessAuthorityPerson;
  readonly chosen: boolean;
  readonly onChoose: () => void;
}): ReactNode {
  const person = props.person;
  const named = tenantPersonName(person);
  const marks = permissionPersonMarks(person);
  return (
    <span className="flex w-0 min-w-full items-center gap-2">
      <span className="truncate">
        <PermissionPersonName person={person} />
      </span>
      {named.githubLogin === undefined ? null : (
        <span className="text-ink-3 truncate text-sm">{named.githubLogin}</span>
      )}
      {marks.length === 0 ? null : (
        <span className="text-ink-3 shrink-0 text-sm">{marks.join(" ")}</span>
      )}
      <span className="ms-auto shrink-0">
        <Button
          size="sm"
          variant="quiet"
          pressed={props.chosen}
          onClick={props.onChoose}
        >
          Choose <span className="visually-hidden">{named.name}</span>
        </Button>
      </span>
    </span>
  );
}

function PermissionAdditionPerson(props: {
  readonly people: readonly AccessAuthorityPerson[];
  readonly chosen: AccessAuthorityPerson | undefined;
  readonly onChoose: (person: AccessAuthorityPerson) => void;
}): ReactNode {
  return (
    <SearchableRoster
      label="Filter"
      rows={props.people}
      textOf={(person) => {
        const named = tenantPersonName(person);
        return `${named.name} ${named.githubLogin ?? ""}`;
      }}
      keyOf={(person) => person.subject}
      renderRow={(person) => (
        <PermissionAdditionChoice
          person={person}
          chosen={props.chosen?.subject === person.subject}
          onChoose={() => {
            props.onChoose(person);
          }}
        />
      )}
    />
  );
}

/** What the dialog has chosen so far, forgotten each time it opens. */
function usePermissionDraft(): {
  readonly choice: PermissionChoice | undefined;
  readonly person: AccessAuthorityPerson | undefined;
  readonly choose: (choice: PermissionChoice | undefined) => void;
  readonly choosePerson: (person: AccessAuthorityPerson) => void;
  readonly begin: () => void;
} {
  const [choice, setChoice] = useState<PermissionChoice | undefined>(undefined);
  const [person, setPerson] = useState<AccessAuthorityPerson | undefined>(
    undefined,
  );
  return {
    choice,
    person,
    choose: setChoice,
    choosePerson: setPerson,
    begin: () => {
      setChoice(undefined);
      setPerson(undefined);
    },
  };
}

function PermissionAdditionBody(props: {
  readonly choices: readonly PermissionChoice[];
  readonly people: readonly AccessAuthorityPerson[];
  readonly draft: ReturnType<typeof usePermissionDraft>;
}): ReactNode {
  const draft = props.draft;
  if (props.choices.length === 0)
    return <EmptyState variant="inline" label="Nothing to add" />;
  return (
    <div className="grid min-h-0 gap-3">
      <RadioGroup
        label="Holder"
        value={
          draft.choice === undefined ? "" : permissionChoiceValue(draft.choice)
        }
        options={props.choices.map((offered) => ({
          value: permissionChoiceValue(offered),
          text: offered.words,
          ...(offered.line === undefined ? {} : { description: offered.line }),
        }))}
        onChoose={(value) => {
          draft.choose(
            props.choices.find(
              (offered) => permissionChoiceValue(offered) === value,
            ),
          );
        }}
      />
      {draft.choice?.kind === "Person" ? (
        <PermissionAdditionPerson
          people={props.people}
          chosen={draft.person}
          onChoose={draft.choosePerson}
        />
      ) : null}
    </div>
  );
}

function PermissionAdditionFoot<Authority extends PermissionAuthority>(props: {
  readonly row: PermissionRow<Authority>;
  readonly holder: PermissionHolder | undefined;
  readonly adding: ConsoleWriting<
    PermissionHolderPressed<Authority>,
    undefined
  >;
  readonly onAdded: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { row, holder, adding } = props;
  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        disabled={adding.isPending}
        onClick={props.onCancel}
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={holder === undefined || adding.isPending}
        busy={adding.isPending}
        onClick={() => {
          if (holder !== undefined)
            adding.mutate({ row, holder }, { onSuccess: props.onAdded });
        }}
      >
        Add
      </Button>
    </>
  );
}

function PermissionAdditionPlus(): ReactNode {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0">
      <path
        d="M6 2.5 V9.5 M2.5 6 H9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PermissionAddition<
  Authority extends PermissionAuthority,
>(props: {
  readonly row: PermissionRow<Authority>;
  readonly addition: PermissionsAddition<Authority>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const row = props.row;
  const addition = props.addition;
  const draft = usePermissionDraft();
  const adding = useConsoleWrite(addition.write(row));
  const choices = addition.choices(row);
  return (
    <Dialog
      title="Add holder"
      trigger={
        <>
          <PermissionAdditionPlus />
          <span>
            Add <span className="visually-hidden">{`to ${row.name}`}</span>
          </span>
        </>
      }
      triggerVariant="quiet"
      open={open}
      onOpenChange={(opened) => {
        if (opened) {
          draft.begin();
          adding.reset();
        }
        setOpen(opened);
      }}
      busy={adding.isPending}
      note={adding.error?.message}
      foot={
        choices.length === 0 ? undefined : (
          <PermissionAdditionFoot
            row={row}
            holder={permissionChoiceHolder(draft.choice, draft.person)}
            adding={adding}
            onAdded={() => {
              setOpen(false);
            }}
            onCancel={() => {
              setOpen(false);
            }}
          />
        )
      }
    >
      <PermissionAdditionBody
        choices={choices}
        people={addition.people(row)}
        draft={draft}
      />
    </Dialog>
  );
}
