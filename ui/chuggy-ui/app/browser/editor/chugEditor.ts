/**
 * A CodeMirror ticket editor, kept free of React so the view owns the document
 * and the binding owns nothing but the handle.
 *
 * It is mounted into a shadow root rather than the page: CodeMirror styles
 * itself by writing a style element at run time, and the console is served
 * under a policy that permits no inline style. A shadow root has no head, so
 * style-mod adopts a constructed sheet instead, which the policy does not
 * govern; design tokens still inherit through, so the theme reads the same
 * variables every other sheet does.
 *
 * What the document may say is handed in as a vocabulary rather than known
 * here, so completion and the hints a key explains itself with are the
 * form's own sentences.
 */

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { yaml } from "@codemirror/lang-yaml";
import {
  foldAll,
  HighlightStyle,
  syntaxHighlighting,
  unfoldAll,
} from "@codemirror/language";
import {
  lintGutter,
  setDiagnostics,
  setDiagnosticsEffect,
  type Diagnostic,
} from "@codemirror/lint";
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  hoverTooltip,
  WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";

import { chugFragments } from "./chugFragments.ts";
import type { TicketYamlProblem } from "./ticketYaml.ts";
import type { TicketYamlKey } from "./ticketYamlKey.ts";
import type { TicketYamlCatalog } from "./ticketYamlFragments.ts";

export interface EditorHandle {
  getValue(): string;
  setValue(text: string): void;
  setVim(enabled: boolean): void;
  setProblems(problems: readonly TicketYamlProblem[]): void;
  setVocabulary(vocabulary: readonly TicketYamlKey[]): void;
  focus(): void;
  destroy(): void;
  foldAll(): void;
  unfoldAll(): void;
  /** The catalog the text's references resolve against, none where its configuration is no catalog. */
  setCatalog(catalog: TicketYamlCatalog | undefined): void;
  expandReferences(): void;
  collapseReferences(): void;
}

export interface EditorOptions {
  readonly doc: string;
  readonly onChange: (text: string) => void;
  readonly vim: boolean;
  readonly vocabulary: readonly TicketYamlKey[];
}

class InlineFinding extends WidgetType {
  readonly message: string;
  constructor(message: string) {
    super();
    this.message = message;
  }
  override eq(other: InlineFinding): boolean {
    return this.message === other.message;
  }
  toDOM(): HTMLElement {
    const label = document.createElement("span");
    label.className = "cm-inline-finding";
    label.textContent = this.message;
    return label;
  }
}

/** Findings are cleared by the first edit, because the text they described is gone. */
const inlineFindings = StateField.define<ReturnType<typeof Decoration.set>>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    let next = transaction.docChanged ? Decoration.none : value;
    for (const effect of transaction.effects)
      if (effect.is(setDiagnosticsEffect))
        next = Decoration.set(
          effect.value.map((diagnostic) =>
            Decoration.widget({
              widget: new InlineFinding(diagnostic.message),
              side: 10,
            }).range(transaction.state.doc.lineAt(diagnostic.from).to),
          ),
          true,
        );
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** A problem's span, held inside the document it was read from. */
function chugEditorDiagnosticOf(
  state: EditorState,
  problem: TicketYamlProblem,
): Diagnostic {
  const length = state.doc.length;
  const from = Math.max(0, Math.min(problem.from, length));
  return {
    from,
    to: Math.max(from, Math.min(problem.to, length)),
    message: problem.message,
    severity: "error",
  };
}

/**
 * Where the caret is asking for something: a top-level key, a key's value, an
 * item of a list under a key, or a key inside a program's stage, with how much
 * of the answer is already typed. Read from the line alone, and the lines
 * above it for a list item's owner, because a half-typed line is exactly the
 * text a parser gives up on.
 */
export type ChugEditorAsked =
  | { readonly asked: "Key"; readonly typed: number }
  | {
      readonly asked: "Value";
      readonly key: string;
      readonly typed: number;
      /** Present where the key is written inside a stage or a workload. */
      readonly nested?: true;
    }
  | { readonly asked: "Nested"; readonly typed: number }
  | { readonly asked: "Field"; readonly typed: number };

const chugEditorKeyAsked = /^(\w*)$/;
const chugEditorFieldAsked = /^(\s+)(\w*)$/;
const chugEditorValueAsked =
  /^\s*(?:-\s+)?(\w+):\s*(?:\[(?:[^\]]*,)?\s*)?([\w./-]*)$/;
const chugEditorItemAsked = /^(\s+)-\s+([\w./-]*)$/;
const chugEditorOwnerLine = /^(\s*)(\w+):/;

/** The key nearest above that a line indented this far sits under, and whether that key is itself indented, none where no line above owns it. */
function chugEditorOwnerOf(
  above: readonly string[],
  indent: number,
): { readonly key: string; readonly nested: boolean } | undefined {
  for (const line of above) {
    const owner = chugEditorOwnerLine.exec(line);
    const ownerIndent = owner?.[1]?.length ?? 0;
    if (owner?.[2] !== undefined && ownerIndent < indent)
      return { key: owner[2], nested: ownerIndent > 0 };
  }
  return undefined;
}

/** The key at the top of the document a line sits under. */
function chugEditorTopOf(above: readonly string[]): string | undefined {
  return chugEditorOwnerOf(above, 1)?.key;
}

/** The key of this name written at a line's depth, or of this name anywhere where none is. */
function chugEditorKeyOf(
  keys: readonly TicketYamlKey[],
  name: string,
  nested: boolean,
): TicketYamlKey | undefined {
  const named = keys.filter((key) => key.key === name);
  return named.find((key) => (key.place !== undefined) === nested) ?? named[0];
}

/** The caret's line up to the caret, and the lines above it nearest first. */
export function chugEditorAsked(
  before: string,
  above: readonly string[],
): ChugEditorAsked | undefined {
  if (chugEditorKeyAsked.test(before))
    return { asked: "Key", typed: before.length };
  const field = chugEditorFieldAsked.exec(before);
  if (field !== null)
    return chugEditorTopOf(above) === "workloads" ||
      chugEditorTopOf(above) === "selection"
      ? { asked: "Field", typed: field[2]?.length ?? 0 }
      : undefined;
  const value = chugEditorValueAsked.exec(before);
  if (value?.[1] !== undefined)
    return {
      asked: "Value",
      key: value[1],
      typed: value[2]?.length ?? 0,
      ...(/^\s/u.test(before) ? { nested: true as const } : {}),
    };
  const item = chugEditorItemAsked.exec(before);
  if (item === null) return undefined;
  const typed = item[2]?.length ?? 0;
  const owner = chugEditorOwnerOf(above, item[1]?.length ?? 0);
  if (owner?.key === "program") return { asked: "Nested", typed };
  return owner === undefined
    ? undefined
    : {
        asked: "Value",
        key: owner.key,
        typed,
        ...(owner.nested ? { nested: true as const } : {}),
      };
}

function chugEditorAskedAt(
  context: CompletionContext,
): ChugEditorAsked | undefined {
  const line = context.state.doc.lineAt(context.pos);
  const above = Array.from(
    { length: line.number - 1 },
    (_, index) => context.state.doc.line(line.number - 1 - index).text,
  );
  return chugEditorAsked(line.text.slice(0, context.pos - line.from), above);
}

/** What the vocabulary offers where the caret asks, and nothing where it
 * offers nothing. */
export function chugEditorOffered(
  asked: ChugEditorAsked,
  keys: readonly TicketYamlKey[],
): readonly Completion[] {
  switch (asked.asked) {
    case "Key":
    case "Nested":
    case "Field":
      return keys
        .filter(
          (key) =>
            key.place ===
            { Key: undefined, Nested: "Stage", Field: "Workload" }[asked.asked],
        )
        .map((key) => ({
          label: key.key,
          apply: `${key.key}: `,
          info: key.hint,
          type: "property",
        }));
    case "Value":
      return (
        chugEditorKeyOf(keys, asked.key, asked.nested === true)?.values ?? []
      ).map((value) => ({
        label: value.label,
        ...(value.detail === undefined ? {} : { detail: value.detail }),
        type: "constant",
      }));
  }
}

function chugEditorCompletion(
  vocabulary: () => readonly TicketYamlKey[],
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const asked = chugEditorAskedAt(context);
    if (asked === undefined) return null;
    const options = chugEditorOffered(asked, vocabulary());
    return options.length === 0
      ? null
      : { from: context.pos - asked.typed, options };
  };
}

const chugEditorHintedKey = /^(\s*(?:-\s+)?)(\w+):/;

/** The key a column of one line rests on, and where on the line it is. */
export function chugEditorKeyAt(
  line: string,
  column: number,
):
  | { readonly key: string; readonly from: number; readonly to: number }
  | undefined {
  const found = chugEditorHintedKey.exec(line);
  if (found?.[2] === undefined) return undefined;
  const from = found[1]?.length ?? 0;
  const to = from + found[2].length;
  return column < from || column > to ? undefined : { key: found[2], from, to };
}

/** A key explains itself when a pointer rests on it. */
function chugEditorHints(vocabulary: () => readonly TicketYamlKey[]) {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const at = chugEditorKeyAt(line.text, pos - line.from);
    if (at === undefined) return null;
    const hint = chugEditorKeyOf(vocabulary(), at.key, at.from > 0)?.hint;
    if (hint === undefined || hint === "") return null;
    return {
      pos: line.from + at.from,
      end: line.from + at.to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-key-hint";
        dom.textContent = hint;
        return { dom };
      },
    };
  });
}

/** A text this handle was given rather than one the author typed, so it is
 * not reported back as typing. */
const chugEditorGiven = Annotation.define<true>();

const ticketHighlighting = HighlightStyle.define([
  { tag: [tags.propertyName, tags.keyword], color: "var(--syntax-key)" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-value)" },
  { tag: tags.comment, color: "var(--syntax-note)", fontStyle: "italic" },
]);

/**
 * The editor styles itself, because a shadow root is out of the page sheets'
 * reach. A narrow screen gets a type size a phone will not zoom into and
 * gutters a finger can hit.
 */
const editorTheme = EditorView.theme({
  "&": {
    color: "var(--ink-1)",
    backgroundColor: "var(--surface-2)",
    height: "100%",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-md)",
    caretColor: "var(--ink-1)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface-1)",
    color: "var(--ink-3)",
    border: "none",
    borderRight: "var(--hairline) solid var(--edge)",
  },
  ".cm-activeLine": { backgroundColor: "var(--bubble)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--bubble)" },
  ".cm-cursor": { borderLeftColor: "var(--ink-1)" },
  ".cm-inline-finding": {
    marginLeft: "var(--space-3)",
    color: "var(--tone-fail)",
    fontSize: "var(--text-sm)",
  },
  "@media (max-width: 40em)": {
    ".cm-content": { fontSize: "var(--text-unzoomed)" },
  },
  "@media (pointer: coarse)": {
    ".cm-foldGutter .cm-gutterElement, .cm-lint-marker": {
      minWidth: "var(--height-touch)",
      minHeight: "var(--height-touch)",
    },
  },
  /**
   * Tooltips are drawn by CodeMirror inside the same shadow root, and nothing
   * registers a dark CodeMirror theme, so without these rules they fall
   * through to CodeMirror's own light one whichever mode is active.
   */
  ".cm-tooltip": {
    background: "var(--surface-1)",
    color: "var(--ink-1)",
    border: "var(--hairline) solid var(--edge)",
    borderRadius: "var(--radius-2)",
  },
  ".cm-key-hint, .cm-tooltip-lint": {
    maxWidth: "min(40em, 90vw)",
    padding: "var(--space-1) var(--space-2)",
    fontSize: "var(--text-sm)",
    fontFamily: "var(--font-prose)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-md)",
    maxHeight: "16em",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    color: "var(--ink-1)",
    padding: "var(--space-1) var(--space-2)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "var(--surface-2)",
    color: "var(--ink-1)",
  },
  ".cm-tooltip.cm-completionInfo": {
    maxWidth: "min(30em, 60vw)",
    padding: "var(--space-1) var(--space-2)",
    fontFamily: "var(--font-prose)",
    fontSize: "var(--text-sm)",
  },
  ".cm-fragment-reference": {
    textDecoration: "underline dotted",
    textUnderlineOffset: "0.2em",
  },
  ".cm-fragment-actions": { marginLeft: "var(--space-2)" },
  ".cm-fragment-action": {
    font: "inherit",
    color: "var(--ink-3)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0 var(--space-1)",
  },
  ".cm-fragment-action:hover": { color: "var(--ink-1)" },
  ".cm-fragment-preview": {
    margin: "var(--space-1) 0 var(--space-1) var(--space-4)",
    padding: "var(--space-1) var(--space-3)",
    borderLeft: "var(--hairline) solid var(--edge)",
    background: "var(--surface-1)",
    fontFamily: "var(--font-mono)",
    whiteSpace: "pre-wrap",
  },
  ".cm-fragment-label": {
    color: "var(--ink-3)",
    fontSize: "var(--text-sm)",
    fontFamily: "var(--font-prose)",
  },
  ".cm-fragment-prose": { fontFamily: "var(--font-prose)" },
  ".cm-completionDetail": {
    color: "var(--ink-3)",
    marginLeft: "var(--space-2)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete .cm-completionMatchedText": {
    color: "inherit",
    fontWeight: "var(--weight-strong)",
  },
});

/** Everything the view is built with, the vim keys behind a compartment so
 * they can be switched without rebuilding it. */
function chugEditorExtensions(
  options: EditorOptions,
  vimCompartment: Compartment,
  vocabulary: () => readonly TicketYamlKey[],
  fragments: Extension,
): Extension {
  return [
    fragments,
    vimCompartment.of(options.vim ? vim() : []),
    basicSetup,
    yaml(),
    syntaxHighlighting(ticketHighlighting),
    editorTheme,
    lintGutter(),
    inlineFindings,
    autocompletion({ override: [chugEditorCompletion(vocabulary)] }),
    chugEditorHints(vocabulary),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      const given = update.transactions.some(
        (transaction) => transaction.annotation(chugEditorGiven) === true,
      );
      if (update.docChanged && !given)
        options.onChange(update.state.doc.toString());
    }),
  ];
}

export function createChugEditor(
  parent: Element | DocumentFragment,
  options: EditorOptions,
): EditorHandle {
  const vimCompartment = new Compartment();
  let vocabulary = options.vocabulary;
  const fragments = chugFragments(ticketHighlighting);
  const state = EditorState.create({
    doc: options.doc,
    extensions: chugEditorExtensions(
      options,
      vimCompartment,
      () => vocabulary,
      fragments.extension,
    ),
  });
  const view = new EditorView({ state, parent });
  return {
    destroy() {
      view.destroy();
    },
    getValue() {
      return view.state.doc.toString();
    },
    focus() {
      view.focus();
    },
    foldAll() {
      foldAll(view);
    },
    unfoldAll() {
      unfoldAll(view);
    },
    setValue(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: chugEditorGiven.of(true),
      });
    },
    setVim(enabled) {
      view.dispatch({
        effects: vimCompartment.reconfigure(enabled ? vim() : []),
      });
    },
    setVocabulary(next) {
      vocabulary = next;
    },
    setCatalog(catalog) {
      fragments.setCatalog(view, catalog);
    },
    expandReferences() {
      fragments.expandAll(view);
    },
    collapseReferences() {
      fragments.collapseAll(view);
    },
    setProblems(problems) {
      view.dispatch(
        setDiagnostics(
          view.state,
          problems.map((problem) =>
            chugEditorDiagnosticOf(view.state, problem),
          ),
        ),
      );
    },
  };
}
