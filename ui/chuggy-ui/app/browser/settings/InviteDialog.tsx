/**
 * What the dialogs that invite share: the choice between inviting a person
 * and making a link, and the foot under either, which is the two actions of a
 * form until a link is made and `Done` alone once one is.
 */

import type { ReactNode } from "react";

import { inviteModes, inviteModesLabel } from "../../core/inviteLinks.ts";
import type { InviteMode } from "../../core/inviteLinks.ts";
import { Button } from "../ui/Button.tsx";
import { ToggleGroup } from "../ui/ToggleGroup.tsx";

/** Which of the two the dialog makes, a press taken only while nothing is unanswered. */
export function InviteModes(props: {
  readonly mode: InviteMode;
  readonly busy: boolean;
  readonly onChoose: (mode: InviteMode) => void;
}): ReactNode {
  return (
    <div>
      <ToggleGroup
        label={inviteModesLabel}
        options={inviteModes}
        value={props.mode}
        onChange={(value) => {
          const mode = inviteModes.find((known) => known === value);
          if (mode !== undefined && !props.busy) props.onChoose(mode);
        }}
      />
    </div>
  );
}

export function InviteFoot(props: {
  /** Whether the dialog holds a link it made, which only `Done` puts away. */
  readonly made: boolean;
  readonly busy: boolean;
  readonly sendable: boolean;
  /** What sending the form is called, and while it is unanswered. */
  readonly words: { readonly idle: string; readonly busy: string };
  readonly onSend: () => void;
  readonly onClose: () => void;
}): ReactNode {
  if (props.made)
    return (
      <Button variant="primary" size="sm" onClick={props.onClose}>
        Done
      </Button>
    );
  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        disabled={props.busy}
        onClick={props.onClose}
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={!props.sendable || props.busy}
        busy={props.busy}
        onClick={props.onSend}
      >
        {props.busy ? props.words.busy : props.words.idle}
      </Button>
    </>
  );
}
