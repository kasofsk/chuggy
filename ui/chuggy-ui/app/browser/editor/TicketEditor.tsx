/**
 * The React binding for the ticket editor: it owns the handle's lifetime and
 * nothing else. The document lives in the CodeMirror view, so this component
 * pushes a new text into the view only when the text it is given is not the
 * text the view already holds — otherwise every keystroke would replace the
 * document under the caret.
 *
 * It is the default export because it is loaded as a chunk of its own: an
 * author who never opens the YAML never downloads the editor.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { Button } from "../ui/Button.tsx";
import { createChugEditor } from "./chugEditor.ts";
import type { EditorHandle } from "./chugEditor.ts";
import type { TicketYamlKey, TicketYamlProblem } from "./ticketYaml.ts";

import "./TicketEditor.css";

export interface TicketEditorProps {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly problems: readonly TicketYamlProblem[];
  readonly vocabulary: readonly TicketYamlKey[];
}

function useEditorHandle(props: TicketEditorProps): {
  readonly host: RefObject<HTMLDivElement | null>;
  readonly handle: RefObject<EditorHandle | null>;
  readonly ready: boolean;
} {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const held = useRef(props);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    held.current = props;
  });
  useEffect(() => {
    const node = host.current;
    if (node === null) return;
    const root = node.shadowRoot ?? node.attachShadow({ mode: "open" });
    handle.current = createChugEditor(root, {
      doc: held.current.value,
      onChange: (text) => {
        held.current.onChange(text);
      },
      vim: false,
      vocabulary: held.current.vocabulary,
    });
    setReady(true);
    return () => {
      handle.current?.destroy();
      handle.current = null;
      setReady(false);
    };
  }, []);
  return { host, handle, ready };
}

/**
 * Whether vim keys are on outlives the editor, because it is how this author
 * types rather than a fact about the document. Browser storage can throw or
 * come back empty, so a reader that fails is simply an author who is not a vim
 * user, and a write that fails costs the preference and nothing else.
 */
const vimStorageKey = "chug.editor.vim";

function ticketEditorVimRemembered(): boolean {
  try {
    return window.localStorage.getItem(vimStorageKey) === "true";
  } catch {
    return false;
  }
}

function ticketEditorVimKept(enabled: boolean): void {
  try {
    window.localStorage.setItem(vimStorageKey, String(enabled));
  } catch {
    /** A preference that cannot be stored is still applied to this editor. */
  }
}

function EditorActions(props: {
  readonly handle: RefObject<EditorHandle | null>;
  readonly ready: boolean;
}): ReactNode {
  const [vimming, setVimming] = useState(ticketEditorVimRemembered);
  const { handle, ready } = props;
  useEffect(() => {
    if (ready && vimming) handle.current?.setVim(true);
  }, [ready, handle, vimming]);
  return (
    <div className="ticket-editor-actions">
      <Button
        size="sm"
        variant="quiet"
        onClick={() => {
          handle.current?.foldAll();
        }}
      >
        Fold all
      </Button>
      <Button
        size="sm"
        variant="quiet"
        onClick={() => {
          handle.current?.unfoldAll();
        }}
      >
        Unfold all
      </Button>
      <label>
        <input
          type="checkbox"
          checked={vimming}
          onChange={(event) => {
            setVimming(event.target.checked);
            handle.current?.setVim(event.target.checked);
            ticketEditorVimKept(event.target.checked);
          }}
        />
        <span>Vim keys</span>
      </label>
    </div>
  );
}

export default function TicketEditor(props: TicketEditorProps): ReactNode {
  const { host, handle, ready } = useEditorHandle(props);
  useEffect(() => {
    if (ready && handle.current?.getValue() !== props.value)
      handle.current?.setValue(props.value);
  }, [ready, handle, props.value]);
  /** Problems are handed over by what they say, so a render that restates the
     same ones does not redraw them. */
  const problems = props.problems;
  const said = JSON.stringify(problems);
  useEffect(() => {
    if (ready) handle.current?.setProblems(problems);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `said` is `problems`
  }, [ready, handle, said]);
  useEffect(() => {
    if (ready) handle.current?.setVocabulary(props.vocabulary);
  }, [ready, handle, props.vocabulary]);
  return (
    <div className="ticket-editor">
      <EditorActions handle={handle} ready={ready} />
      <div
        className="ticket-editor-host"
        role="group"
        aria-label="Ticket YAML"
        ref={host}
      />
    </div>
  );
}
