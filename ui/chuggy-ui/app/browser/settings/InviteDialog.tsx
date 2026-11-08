/**
 * What the dialogs that invite share: the choice between inviting a person
 * and making a link, and the foot under either, which is the two actions of a
 * form until a link is made and `Done` alone once one is.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  inviteModeLabel,
  inviteModes,
  inviteModesLabel,
} from "../../core/inviteLinks.ts";
import type { InviteMode, InviteSendWords } from "../../core/inviteLinks.ts";
import { Button } from "../ui/Button.tsx";
import { ToggleGroup } from "../ui/ToggleGroup.tsx";

/** Which of the two the dialog makes, a press taken only while nothing is
 * unanswered, each drawn and told apart by its label. */
export function InviteModes(props: {
  readonly mode: InviteMode;
  readonly busy: boolean;
  readonly onChoose: (mode: InviteMode) => void;
}): ReactNode {
  const text = useCopyText();
  const label = (mode: InviteMode): string => text(inviteModeLabel(mode));
  return (
    <div>
      <ToggleGroup
        label={text(inviteModesLabel)}
        options={inviteModes.map(label)}
        value={label(props.mode)}
        onChange={(value) => {
          const mode = inviteModes.find((known) => label(known) === value);
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
  readonly words: InviteSendWords;
  readonly onSend: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const text = useCopyText();
  if (props.made)
    return (
      <Button variant="primary" size="sm" onClick={props.onClose}>
        {text({ id: "settings-done" })}
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
        {text({ id: "settings-cancel" })}
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={!props.sendable || props.busy}
        busy={props.busy}
        onClick={props.onSend}
      >
        {text(props.busy ? props.words.busy : props.words.idle)}
      </Button>
    </>
  );
}
