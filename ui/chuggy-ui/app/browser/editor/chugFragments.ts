/**
 * The catalog names a ticket's text writes, drawn as references: each one can
 * be looked through beneath its line, a level at a time, and a workload or a
 * prompt file can be taken into the text to be edited there.
 *
 * WHAT A NAME RESOLVES TO IS HANDED IN, as the catalog the text's
 * configuration is, so the editor reads nothing and a text naming another
 * configuration is redrawn by the next one handed in.
 *
 * A PREVIEW IS READ-ONLY AND OWNS ITS OWN NESTING. The references inside one
 * open and close within it, and only taking something into the text changes
 * the document.
 */

import { yamlLanguage } from "@codemirror/lang-yaml";
import type { HighlightStyle } from "@codemirror/language";
import {
  type EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { highlightCode } from "@lezer/highlight";

import {
  ticketYamlMaterializable,
  ticketYamlMaterialized,
  ticketYamlReferences,
} from "./ticketYamlFragments.ts";
import type {
  TicketYamlCatalog,
  TicketYamlFragmentRoot,
  TicketYamlReference,
} from "./ticketYamlFragments.ts";

/** How deep a preview nests before its references stop opening. */
const chugFragmentsDepthMax = 8;

interface ChugFragmentsState {
  readonly catalog: TicketYamlCatalog | undefined;
  readonly expanded: ReadonlySet<string>;
}

const chugFragmentsChanged = StateEffect.define<
  | { readonly catalog: TicketYamlCatalog | undefined }
  | { readonly toggled: string }
  | { readonly expanded: ReadonlySet<string> }
>();

function chugFragmentsButton(
  label: string,
  text: string,
  action: () => void,
): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "cm-fragment-action";
  node.title = label;
  node.setAttribute("aria-label", label);
  node.textContent = text;
  node.onmousedown = (event) => {
    event.preventDefault();
  };
  node.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  return node;
}

/** The document with one reference taken into it, where it still says what the reference was read from. */
function chugFragmentsMaterialize(
  view: EditorView,
  reference: TicketYamlReference,
  catalog: TicketYamlCatalog,
): void {
  const source = view.state.doc.toString();
  const next = ticketYamlMaterialized(source, reference, catalog);
  if (next === undefined || next === source) return;
  view.dispatch({
    changes: { from: 0, to: source.length, insert: next },
    userEvent: "input.materialize",
  });
  view.focus();
}

/** One line of a fragment as highlighted spans, a reference's characters marked as one. */
function chugFragmentsLine(
  text: string,
  offset: number,
  spans: readonly { readonly text: string; readonly classes: string }[],
  references: readonly TicketYamlReference[],
): HTMLElement {
  const line = document.createElement("div");
  let at = offset;
  for (const span of spans) {
    const cuts = [
      0,
      ...references.flatMap((reference) => [
        reference.from - at,
        reference.to - at,
      ]),
      span.text.length,
    ]
      .filter((cut) => cut >= 0 && cut <= span.text.length)
      .sort((a, b) => a - b);
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const from = cuts[index] ?? 0;
      const to = cuts[index + 1] ?? 0;
      if (from === to) continue;
      const piece = document.createElement("span");
      const referenced = references.some(
        (reference) => reference.from <= at + from && at + to <= reference.to,
      );
      piece.className = [
        span.classes,
        referenced ? "cm-fragment-reference" : "",
      ]
        .filter((name) => name !== "")
        .join(" ");
      piece.textContent = span.text.slice(from, to);
      line.append(piece);
    }
    at += span.text.length;
  }
  if (line.childNodes.length === 0) line.append(document.createTextNode(text));
  return line;
}

/** A fragment's text as lines of highlighted spans, each with where it starts. */
function chugFragmentsHighlighted(
  text: string,
  highlighter: HighlightStyle,
): readonly {
  readonly offset: number;
  readonly spans: { readonly text: string; readonly classes: string }[];
}[] {
  const lines: {
    offset: number;
    spans: { readonly text: string; readonly classes: string }[];
  }[] = [{ offset: 0, spans: [] }];
  let at = 0;
  highlightCode(
    text,
    yamlLanguage.parser.parse(text),
    highlighter,
    (piece, classes) => {
      lines.at(-1)?.spans.push({ text: piece, classes });
      at += piece.length;
    },
    () => {
      at += 1;
      lines.push({ offset: at, spans: [] });
    },
  );
  return lines;
}

interface ChugFragmentsPreviewOptions {
  readonly catalog: TicketYamlCatalog;
  readonly highlighter: HighlightStyle;
  readonly view: EditorView;
}

/** One fragment looked through: its text, each reference in it able to open beneath its own line. */
function chugFragmentsPreview(
  root: TicketYamlFragmentRoot,
  name: string,
  options: ChugFragmentsPreviewOptions,
  depth: number,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "cm-fragment-preview";
  const label = document.createElement("div");
  label.className = "cm-fragment-label";
  label.textContent = `${root.toLowerCase()} ${name}`;
  section.append(label);
  const text =
    root === "Ticket" ? undefined : options.catalog.fragment(root, name);
  const body = document.createElement("div");
  body.className = "cm-fragment-body";
  if (text === undefined || root === "Ticket") {
    section.append(body);
    return section;
  }
  if (root === "Prompt") {
    body.classList.add("cm-fragment-prose");
    body.textContent = text;
    section.append(body);
    return section;
  }
  const references = ticketYamlReferences(text, root, options.catalog);
  for (const { offset, spans } of chugFragmentsHighlighted(
    text.replace(/\n$/u, ""),
    options.highlighter,
  )) {
    const length = spans.reduce((sum, span) => sum + span.text.length, 0);
    const within = references.filter(
      (reference) =>
        reference.from >= offset && reference.to <= offset + length,
    );
    const line = chugFragmentsLine("", offset, spans, within);
    const nested = document.createElement("div");
    for (const reference of within)
      line.append(
        ...chugFragmentsNestedActions(reference, nested, options, depth),
      );
    body.append(line, nested);
  }
  section.append(body);
  return section;
}

/** The actions on a reference inside a preview: open it beneath, and take a workload into the text. */
function chugFragmentsNestedActions(
  reference: TicketYamlReference,
  nested: HTMLElement,
  options: ChugFragmentsPreviewOptions,
  depth: number,
): readonly HTMLElement[] {
  if (depth >= chugFragmentsDepthMax) return [];
  let open: HTMLElement | undefined;
  const toggle = chugFragmentsButton(
    `Look through ${reference.name}`,
    "▸",
    () => {
      if (open === undefined) {
        open = chugFragmentsPreview(
          reference.kind,
          reference.name,
          options,
          depth + 1,
        );
        nested.append(open);
      } else {
        open.remove();
        open = undefined;
      }
      toggle.textContent = open === undefined ? "▸" : "▾";
      toggle.setAttribute("aria-expanded", String(open !== undefined));
      options.view.requestMeasure();
    },
  );
  toggle.setAttribute("aria-expanded", "false");
  return reference.kind === "Workload"
    ? [
        toggle,
        chugFragmentsButton(
          `Edit ${reference.name} in this ticket`,
          "◆",
          () => {
            chugFragmentsMaterialize(options.view, reference, options.catalog);
          },
        ),
      ]
    : [toggle];
}

class ChugFragmentsActions extends WidgetType {
  readonly reference: TicketYamlReference;
  readonly expanded: boolean;
  readonly catalog: TicketYamlCatalog;
  constructor(
    reference: TicketYamlReference,
    expanded: boolean,
    catalog: TicketYamlCatalog,
  ) {
    super();
    this.reference = reference;
    this.expanded = expanded;
    this.catalog = catalog;
  }
  override eq(other: ChugFragmentsActions): boolean {
    return (
      this.reference.key === other.reference.key &&
      this.reference.name === other.reference.name &&
      this.expanded === other.expanded &&
      this.catalog === other.catalog
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-fragment-actions";
    const { reference } = this;
    span.append(
      chugFragmentsButton(
        `${this.expanded ? "Close" : "Look through"} ${reference.name}`,
        this.expanded ? "▾" : "▸",
        () => {
          view.dispatch({
            effects: chugFragmentsChanged.of({ toggled: reference.key }),
          });
        },
      ),
    );
    if (ticketYamlMaterializable("Ticket", reference))
      span.append(
        chugFragmentsButton(
          reference.kind === "Prompt"
            ? `Edit the text of ${reference.name} in this ticket`
            : `Edit ${reference.name} in this ticket`,
          "◆",
          () => {
            chugFragmentsMaterialize(view, reference, this.catalog);
          },
        ),
      );
    return span;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

class ChugFragmentsShown extends WidgetType {
  readonly reference: TicketYamlReference;
  readonly catalog: TicketYamlCatalog;
  readonly highlighter: HighlightStyle;
  constructor(
    reference: TicketYamlReference,
    catalog: TicketYamlCatalog,
    highlighter: HighlightStyle,
  ) {
    super();
    this.reference = reference;
    this.catalog = catalog;
    this.highlighter = highlighter;
  }
  override eq(other: ChugFragmentsShown): boolean {
    return (
      this.reference.kind === other.reference.kind &&
      this.reference.name === other.reference.name &&
      this.catalog === other.catalog
    );
  }
  toDOM(view: EditorView): HTMLElement {
    return chugFragmentsPreview(
      this.reference.kind,
      this.reference.name,
      { catalog: this.catalog, highlighter: this.highlighter, view },
      0,
    );
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function chugFragmentsDecorations(
  state: EditorState,
  value: ChugFragmentsState,
  highlighter: HighlightStyle,
) {
  const { catalog } = value;
  if (catalog === undefined) return Decoration.none;
  let references: readonly TicketYamlReference[];
  try {
    references = ticketYamlReferences(state.doc.toString(), "Ticket", catalog);
  } catch {
    return Decoration.none;
  }
  return Decoration.set(
    references.flatMap((reference) => {
      const expanded = value.expanded.has(reference.key);
      const end = state.doc.lineAt(reference.to).to;
      return [
        Decoration.mark({ class: "cm-fragment-reference" }).range(
          reference.from,
          reference.to,
        ),
        Decoration.widget({
          widget: new ChugFragmentsActions(reference, expanded, catalog),
          side: 1,
        }).range(end),
        ...(expanded
          ? [
              Decoration.widget({
                widget: new ChugFragmentsShown(reference, catalog, highlighter),
                block: true,
                side: 2,
              }).range(end),
            ]
          : []),
      ];
    }),
    true,
  );
}

/** The state the references are drawn from: the catalog, which are open, and what that draws. */
function chugFragmentsField(highlighter: HighlightStyle) {
  return StateField.define<
    ChugFragmentsState & {
      readonly decorations: ReturnType<typeof Decoration.set>;
    }
  >({
    create() {
      return {
        catalog: undefined,
        expanded: new Set(),
        decorations: Decoration.none,
      };
    },
    update(value, transaction) {
      const effects = transaction.effects.filter((effect) =>
        effect.is(chugFragmentsChanged),
      );
      if (!transaction.docChanged && effects.length === 0) return value;
      let { catalog } = value;
      const expanded = new Set(value.expanded);
      for (const effect of effects) {
        const change = effect.value;
        if ("catalog" in change) catalog = change.catalog;
        else if ("toggled" in change) {
          if (!expanded.delete(change.toggled)) expanded.add(change.toggled);
        } else {
          expanded.clear();
          for (const key of change.expanded) expanded.add(key);
        }
      }
      const next = { catalog, expanded };
      return {
        ...next,
        decorations: chugFragmentsDecorations(
          transaction.state,
          next,
          highlighter,
        ),
      };
    },
    provide: (held) =>
      EditorView.decorations.from(held, (value) => value.decorations),
  });
}

/** The references a ticket's text writes, as an extension and the two ways it is told of a catalog and of expanding. */
export function chugFragments(highlighter: HighlightStyle): {
  readonly extension: Extension;
  setCatalog(view: EditorView, catalog: TicketYamlCatalog | undefined): void;
  expandAll(view: EditorView): void;
  collapseAll(view: EditorView): void;
} {
  const field = chugFragmentsField(highlighter);
  return {
    extension: field,
    setCatalog(view, catalog) {
      if (view.state.field(field).catalog === catalog) return;
      view.dispatch({ effects: chugFragmentsChanged.of({ catalog }) });
    },
    expandAll(view) {
      const { catalog } = view.state.field(field);
      if (catalog === undefined) return;
      const keys = ticketYamlReferences(
        view.state.doc.toString(),
        "Ticket",
        catalog,
      ).map((reference) => reference.key);
      view.dispatch({
        effects: chugFragmentsChanged.of({ expanded: new Set(keys) }),
      });
    },
    collapseAll(view) {
      view.dispatch({
        effects: chugFragmentsChanged.of({ expanded: new Set() }),
      });
    },
  };
}
