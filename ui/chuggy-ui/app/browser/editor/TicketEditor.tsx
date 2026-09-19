/**
 * The React binding for the ticket editor: it owns the handle's lifetime and
 * nothing else. The document lives in the CodeMirror view, so this component
 * pushes a new text into the view only when the text it is given is not the
 * text the view already holds — otherwise every keystroke would replace the
 * document under the caret.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  createChugEditor,
  type EditorFinding,
  type EditorHandle,
} from "./chugEditor.ts";
import type { FragmentCatalog } from "./fragments.ts";
import "./TicketEditor.css";

export interface TicketEditorProps {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly findings: readonly EditorFinding[];
  readonly files: readonly string[];
  readonly catalog?: FragmentCatalog | undefined;
}

interface EditorLatest {
  readonly onChange: (text: string) => void;
  readonly catalog?: FragmentCatalog | undefined;
  readonly value: string;
}

function useEditorHandle(latest: EditorLatest): {
  readonly host: React.RefObject<HTMLDivElement | null>;
  readonly handle: React.RefObject<EditorHandle | null>;
  readonly ready: boolean;
} {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const held = useRef(latest);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    held.current = latest;
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
      showFindings: true,
      ...(held.current.catalog === undefined
        ? {}
        : { catalog: held.current.catalog }),
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

function vimRemembered(): boolean {
  try {
    return window.localStorage.getItem(vimStorageKey) === "true";
  } catch {
    return false;
  }
}

function rememberVim(enabled: boolean): void {
  try {
    window.localStorage.setItem(vimStorageKey, String(enabled));
  } catch {
    /** A preference that cannot be stored is still applied to this editor. */
  }
}

function EditorActions(props: {
  readonly handle: React.RefObject<EditorHandle | null>;
  readonly references: boolean;
  readonly ready: boolean;
}): ReactNode {
  const [vimming, setVimming] = useState(vimRemembered);
  const { handle, ready } = props;
  useEffect(() => {
    if (ready && vimming) handle.current?.setVim(true);
  }, [ready, handle, vimming]);
  return (
    <div className="ticket-editor-actions">
      <button
        type="button"
        onClick={() => {
          props.handle.current?.foldAll();
        }}
      >
        Fold all
      </button>
      <button
        type="button"
        onClick={() => {
          props.handle.current?.unfoldAll();
        }}
      >
        Unfold all
      </button>
      {props.references ? (
        <>
          <button
            type="button"
            onClick={() => {
              void props.handle.current?.expandReferences();
            }}
          >
            Expand references
          </button>
          <button
            type="button"
            onClick={() => {
              props.handle.current?.collapseReferences();
            }}
          >
            Collapse references
          </button>
        </>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={vimming}
          onChange={(event) => {
            setVimming(event.target.checked);
            props.handle.current?.setVim(event.target.checked);
            rememberVim(event.target.checked);
          }}
        />
        <span>Vim keys</span>
      </label>
    </div>
  );
}

export function TicketEditor(props: TicketEditorProps): ReactNode {
  const { host, handle, ready } = useEditorHandle({
    onChange: props.onChange,
    value: props.value,
    ...(props.catalog === undefined ? {} : { catalog: props.catalog }),
  });
  useEffect(() => {
    if (ready && handle.current?.getValue() !== props.value)
      handle.current?.setValue(props.value);
  }, [ready, handle, props.value]);
  useEffect(() => {
    if (ready) handle.current?.setFindings(props.findings);
  }, [ready, handle, props.findings]);
  useEffect(() => {
    if (ready) handle.current?.setCatalog(props.files);
  }, [ready, handle, props.files]);
  return (
    <div className="ticket-editor">
      <EditorActions
        handle={handle}
        references={props.catalog !== undefined}
        ready={ready}
      />
      <div className="ticket-editor-host" ref={host} />
    </div>
  );
}
