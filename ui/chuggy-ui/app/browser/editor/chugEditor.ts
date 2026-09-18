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
 */
import { Compartment, EditorState, StateField } from "@codemirror/state";
import {
  lintGutter,
  setDiagnostics,
  setDiagnosticsEffect,
  type Diagnostic,
} from "@codemirror/lint";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { basicSetup } from "codemirror";
import { vim } from "@replit/codemirror-vim";
import {
  foldAll,
  unfoldAll,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { fragmentSupport, type FragmentCatalog } from "./fragments.ts";

export type EditorSeverity = Diagnostic["severity"];

export interface EditorFinding {
  readonly line?: number | null;
  readonly column?: number | null;
  readonly message: string;
  readonly severity: EditorSeverity;
}

export interface EditorHandle {
  getValue(): string;
  setValue(text: string): void;
  setVim(enabled: boolean): void;
  setFindings(findings: readonly EditorFinding[]): void;
  setCatalog(files: readonly string[]): void;
  destroy(): void;
  expandReferences(): Promise<void>;
  collapseReferences(): void;
  foldAll(): void;
  unfoldAll(): void;
}

export interface EditorOptions {
  readonly doc: string;
  readonly onChange: (text: string) => void;
  readonly vim: boolean;
  readonly showFindings?: boolean;
  readonly catalog?: FragmentCatalog | undefined;
}

const vimCompartment = new Compartment();

class InlineFinding extends WidgetType {
  readonly message: string;
  readonly severity: EditorSeverity;
  constructor(message: string, severity: EditorSeverity) {
    super();
    this.message = message;
    this.severity = severity;
  }
  override eq(other: InlineFinding): boolean {
    return this.message === other.message && this.severity === other.severity;
  }
  toDOM(): HTMLElement {
    const label = document.createElement("span");
    label.className = "cm-inline-finding";
    label.dataset["severity"] = this.severity;
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
              widget: new InlineFinding(
                diagnostic.message,
                diagnostic.severity,
              ),
              side: 10,
            }).range(transaction.state.doc.lineAt(diagnostic.from).to),
          ),
          true,
        );
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function findingRange(
  state: EditorState,
  line: number | null | undefined,
  column: number | null | undefined,
): { readonly from: number; readonly to: number } {
  if (line === null || line === undefined) return { from: 0, to: 0 };
  const selected = state.doc.line(Math.max(1, Math.min(line, state.doc.lines)));
  const offset = Math.max(0, Math.min((column ?? 1) - 1, selected.length));
  const from = selected.from + offset;
  return { from, to: Math.min(from + 1, selected.to) };
}

const ticketHighlighting = HighlightStyle.define([
  { tag: [tags.propertyName, tags.keyword], color: "var(--syntax-key)" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-value)" },
  { tag: tags.comment, color: "var(--syntax-note)", fontStyle: "italic" },
]);

/** The editor styles itself, because a shadow root is out of the page sheets' reach. */
const editorTheme = EditorView.theme({
  "&": { color: "var(--ink-1)", backgroundColor: "var(--surface-2)" },
  ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--ink-1)" },
  ".cm-gutters": {
    backgroundColor: "var(--surface-1)",
    color: "var(--ink-3)",
    border: "none",
    borderRight: "var(--hairline) solid var(--edge)",
  },
  ".cm-activeLine": { backgroundColor: "var(--bubble)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--bubble)" },
  ".cm-inline-finding": {
    marginLeft: "var(--space-3)",
    color: "var(--tone-fail)",
    fontSize: "var(--text-sm)",
  },
  ".cm-project-file-reference": { textDecoration: "underline dotted" },
  ".cm-fragment-actions": { marginLeft: "var(--space-2)" },
  ".cm-fragment-action": {
    border: "var(--hairline) solid var(--edge-control)",
    borderRadius: "var(--radius-1)",
    background: "transparent",
    color: "var(--ink-2)",
    cursor: "pointer",
    marginLeft: "var(--space-1)",
    minHeight: "24px",
    minWidth: "24px",
  },
  "@media (pointer: coarse)": {
    ".cm-fragment-action": { minHeight: "44px", minWidth: "44px" },
  },
  ".cm-fragment-content": {
    border: "var(--hairline) solid var(--edge)",
    borderRadius: "var(--radius-2)",
    background: "var(--surface-1)",
    margin: "var(--space-2) 0",
    padding: "var(--space-2)",
  },
  ".cm-fragment-label": {
    color: "var(--ink-3)",
    fontSize: "var(--text-sm)",
    letterSpacing: "var(--tracking-label)",
  },
  ".cm-nested-file-preview": {
    borderLeft: "var(--rail) solid var(--edge-strong)",
    marginTop: "var(--space-2)",
    paddingLeft: "var(--space-2)",
  },
  /**
   * The completion list is drawn by CodeMirror inside the same shadow root, and
   * nothing registers a dark CodeMirror theme, so without these rules it falls
   * through to CodeMirror's own light one whichever mode is active.
   */
  ".cm-tooltip.cm-tooltip-autocomplete": {
    background: "var(--surface-1)",
    color: "var(--ink-1)",
    border: "var(--hairline) solid var(--edge)",
    borderRadius: "var(--radius-2)",
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
  },
  ".cm-tooltip.cm-tooltip-autocomplete .cm-completionMatchedText": {
    color: "inherit",
    fontWeight: "var(--weight-strong)",
  },
});

export function createChugEditor(
  parent: Element | DocumentFragment,
  options: EditorOptions,
): EditorHandle {
  const fragments =
    options.catalog === undefined ? null : fragmentSupport(options.catalog);
  const state = EditorState.create({
    doc: options.doc,
    extensions: [
      basicSetup,
      yaml(),
      syntaxHighlighting(ticketHighlighting),
      editorTheme,
      lintGutter(),
      options.showFindings === true ? inlineFindings : [],
      vimCompartment.of(options.vim ? vim() : []),
      fragments?.extensions ?? [],
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onChange(update.state.doc.toString());
      }),
    ],
  });
  const view = new EditorView({ state, parent });
  return {
    destroy() {
      view.destroy();
    },
    getValue() {
      return view.state.doc.toString();
    },
    setCatalog(files) {
      fragments?.setFiles(view, files);
    },
    async expandReferences() {
      await fragments?.expandAll(view);
    },
    collapseReferences() {
      fragments?.collapseAll(view);
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
      });
    },
    setVim(enabled) {
      view.dispatch({
        effects: vimCompartment.reconfigure(enabled ? vim() : []),
      });
    },
    setFindings(findings) {
      view.dispatch(
        setDiagnostics(
          view.state,
          findings.map((finding) => ({
            ...findingRange(view.state, finding.line, finding.column),
            message: finding.message,
            severity: finding.severity,
          })),
        ),
      );
    },
  };
}
