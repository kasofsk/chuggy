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

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";
import { persistentStore } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import { createChugEditor } from "./chugEditor.ts";
import type { EditorHandle } from "./chugEditor.ts";
import type { TicketYamlProblem } from "./ticketYaml.ts";
import type { TicketYamlKey } from "./ticketYamlKey.ts";
import type { TicketYamlCatalog } from "./ticketYamlFragments.ts";

import "./TicketEditor.css";

export interface TicketEditorProps {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly problems: readonly TicketYamlProblem[];
  readonly vocabulary: readonly TicketYamlKey[];
  /** What the text's catalog names resolve to, none where its configuration is no catalog. */
  readonly catalog: TicketYamlCatalog | undefined;
}

function useEditorHandle(
  props: TicketEditorProps,
  text: CopyText,
): {
  readonly host: RefObject<HTMLDivElement | null>;
  readonly handle: RefObject<EditorHandle | null>;
  readonly ready: boolean;
} {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const held = useRef(props);
  const words = useRef(text);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    held.current = props;
    words.current = text;
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
      text: (copy) => words.current(copy),
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
 * types rather than a fact about the document. A read the store cannot make is
 * an author who is not a vim user, and a write it cannot make costs the
 * preference and nothing else: it is still applied to this editor.
 */
const vimStorageKey = "chug.editor.vim";

function ticketEditorVimRemembered(): boolean {
  return persistentStore.read(vimStorageKey) === "true";
}

function ticketEditorVimKept(enabled: boolean): void {
  persistentStore.write(vimStorageKey, String(enabled));
}

function EditorActions(props: {
  readonly handle: RefObject<EditorHandle | null>;
  readonly ready: boolean;
}): ReactNode {
  const [vimming, setVimming] = useState(ticketEditorVimRemembered);
  const { handle, ready } = props;
  const text = useCopyText();
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
        {text({ id: "ticket-authoring-fold-all" })}
      </Button>
      <Button
        size="sm"
        variant="quiet"
        onClick={() => {
          handle.current?.unfoldAll();
        }}
      >
        {text({ id: "ticket-authoring-unfold-all" })}
      </Button>
      <Button
        size="sm"
        variant="quiet"
        onClick={() => {
          handle.current?.expandReferences();
        }}
      >
        {text({ id: "ticket-authoring-expand-references" })}
      </Button>
      <Button
        size="sm"
        variant="quiet"
        onClick={() => {
          handle.current?.collapseReferences();
        }}
      >
        {text({ id: "ticket-authoring-collapse-references" })}
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
        <span>{text({ id: "ticket-authoring-vim-keys" })}</span>
      </label>
    </div>
  );
}

export default function TicketEditor(props: TicketEditorProps): ReactNode {
  const text = useCopyText();
  const { host, handle, ready } = useEditorHandle(props, text);
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
  useEffect(() => {
    if (ready) handle.current?.setCatalog(props.catalog);
  }, [ready, handle, props.catalog]);
  return (
    <div className="ticket-editor">
      <EditorActions handle={handle} ready={ready} />
      <div
        className="ticket-editor-host"
        role="group"
        aria-label={text({ id: "ticket-authoring-ticket-yaml" })}
        ref={host}
      />
    </div>
  );
}
