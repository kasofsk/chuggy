/**
 * Catalog references inside a ticket document, made visible in place: the
 * referenced file can be previewed below the line that names it, its path can
 * be completed from the catalog the ticket is pinned to, and a reference can be
 * replaced by the mapping it stands for.
 *
 * Two things differ from the editor this is carried over from. References here
 * are authored without the catalog directory prefix, because that is the only
 * form the ticket schema accepts, so nothing strips one. And a reference is not
 * a link: the console reads the catalog with a bearer token, so a plain
 * navigation could not fetch the file the link named, and the preview is the
 * whole affordance.
 */
import {
  autocompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { isMap, isSeq, isScalar, parseDocument } from "yaml";

export interface FragmentCatalog {
  load(reference: string): Promise<{ readonly content: string }>;
  onError(error: unknown): void;
}

export interface FragmentReference {
  readonly reference: string;
  readonly path: readonly (string | number)[];
  readonly key: string;
  readonly from: number;
  readonly to: number;
}

interface FragmentExpansion {
  readonly reference: string;
  readonly content: string;
}

interface FragmentState {
  files: readonly string[];
  expanded: Map<string, FragmentExpansion>;
  decorations: ReturnType<typeof Decoration.set>;
}

interface FragmentChange {
  readonly files?: readonly string[];
  readonly clear?: boolean;
  readonly key?: string;
  readonly value?: FragmentExpansion | null;
}

const changed = StateEffect.define<FragmentChange>();

/** Each field that may name a catalog file, and the directory its files live in. */
const directories: Readonly<Record<string, string>> = {
  work: "workloads/",
  evaluation: "evaluation-plans/",
  finalization: "finalizers/",
  workload: "workloads/",
  evaluators: "evaluators/",
  prompt: "agents/",
  result_contract: "result-contracts/",
};

const fragmentNestingMax = 8;

export function referenceNodes(
  source: string,
  files: readonly string[],
): readonly FragmentReference[] {
  const result: FragmentReference[] = [];
  const known = new Set(files);
  const walk = (node: unknown, path: readonly (string | number)[]): void => {
    if (isMap(node))
      for (const pair of node.items) {
        if (isScalar(pair.key))
          walk(pair.value, [...path, String(pair.key.value)]);
      }
    else if (isSeq(node))
      node.items.forEach((item, index) => {
        walk(item, [...path, index]);
      });
    else if (isScalar(node) && typeof node.value === "string" && node.range) {
      const reference = node.value;
      if (known.has(reference))
        result.push({
          reference,
          path,
          key: JSON.stringify(path),
          from: node.range[0],
          to: node.range[1],
        });
    }
  };
  walk(parseDocument(source).contents, []);
  return result;
}

export function materializedYaml(
  source: string,
  occurrence: FragmentReference,
  content: string,
): string {
  const document = parseDocument(source);
  const fragment = parseDocument(content);
  if (
    document.errors.length ||
    fragment.errors.length ||
    !isMap(fragment.contents)
  )
    throw new Error(
      "Materialization needs valid ticket YAML and a mapping fragment.",
    );
  const current: unknown = document.getIn(occurrence.path);
  if (typeof current !== "string" || current !== occurrence.reference)
    throw new Error("Reference changed. Try materializing it again.");
  const previous = document.getIn(occurrence.path, true);
  const carried = isScalar(previous)
    ? [previous.commentBefore, previous.comment]
    : [];
  const comment = [...carried, fragment.contents.commentBefore]
    .filter((part) => typeof part === "string" && part !== "")
    .join("\n");
  fragment.contents.commentBefore = comment === "" ? null : comment;
  document.setIn(occurrence.path, fragment.contents);
  return document.toString({ lineWidth: 0 });
}

export function fragmentCompletion(files: readonly string[]): CompletionSource {
  return (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const match =
      /^\s*(?:-\s*)?(work|evaluation|finalization|workload|prompt|result_contract):\s*(["']?)([^\s#"']*)$/u.exec(
        before,
      );
    const field = match?.[1];
    const typed = match?.[3];
    if (field === undefined || typed === undefined) return null;
    const directory = directories[field] ?? "";
    return {
      from: context.pos - typed.length,
      options: files
        .filter((file) => file.startsWith(directory))
        .map((label) => ({ label, type: "file" })),
      validFor: /^[^\s#"']*$/u,
    };
  };
}

function button(
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
  node.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  return node;
}

function nestedContent(
  content: string,
  files: readonly string[],
  catalog: FragmentCatalog,
  view: EditorView,
  depth = 0,
): HTMLElement {
  const container = document.createElement("div");
  const body = document.createElement("pre");
  const nested = document.createElement("div");
  const matches = files
    .flatMap((file) =>
      [...content.matchAll(new RegExp(escaped(file), "gu"))].map((match) => ({
        file,
        from: match.index,
        to: match.index + file.length,
      })),
    )
    .sort((left, right) => left.from - right.from || right.to - left.to);
  let position = 0;
  for (const match of matches) {
    if (match.from < position) continue;
    body.append(document.createTextNode(content.slice(position, match.from)));
    const named = document.createElement("span");
    named.textContent = match.file;
    named.className = "cm-project-file-reference";
    body.append(named);
    if (depth < fragmentNestingMax)
      body.append(
        nestedToggle(match.file, files, catalog, view, depth, nested),
      );
    position = match.to;
  }
  body.append(document.createTextNode(content.slice(position)));
  container.append(body, nested);
  return container;
}

function escaped(file: string): string {
  return file.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function nestedToggle(
  file: string,
  files: readonly string[],
  catalog: FragmentCatalog,
  view: EditorView,
  depth: number,
  nested: HTMLElement,
): HTMLButtonElement {
  let panel: HTMLElement | null = null;
  const toggle = button(`Preview ${file}`, "▸", () => {
    toggle.disabled = true;
    void (async () => {
      try {
        if (panel) {
          panel.remove();
          panel = null;
        } else {
          const { content } = await catalog.load(file);
          panel = document.createElement("section");
          panel.className = "cm-nested-file-preview";
          const label = document.createElement("strong");
          label.textContent = file;
          panel.append(
            label,
            nestedContent(content, files, catalog, view, depth + 1),
          );
          nested.append(panel);
        }
        toggle.textContent = panel ? "▾" : "▸";
        toggle.setAttribute("aria-expanded", String(Boolean(panel)));
        view.requestMeasure();
      } catch (error) {
        catalog.onError(error);
      } finally {
        toggle.disabled = false;
      }
    })();
  });
  toggle.setAttribute("aria-expanded", "false");
  return toggle;
}

/** A reference may be replaced by its mapping only where the schema accepts one. */
function materializable(entry: FragmentReference): boolean {
  const field = entry.path.at(-1);
  const inPlace =
    (typeof field === "string" &&
      ["work", "evaluation", "finalization", "workload"].includes(field)) ||
    (typeof field === "number" && entry.path.at(-2) === "evaluators");
  return (
    inPlace &&
    /^(workloads|evaluation-plans|evaluators|finalizers)\/.*\.yaml$/u.test(
      entry.reference,
    )
  );
}

type FragmentAction = (view: EditorView, entry: FragmentReference) => void;

class Actions extends WidgetType {
  readonly entry: FragmentReference;
  readonly expanded: boolean;
  readonly toggle: FragmentAction;
  readonly materialize: FragmentAction;
  constructor(
    entry: FragmentReference,
    expanded: boolean,
    toggle: FragmentAction,
    materialize: FragmentAction,
  ) {
    super();
    this.entry = entry;
    this.expanded = expanded;
    this.toggle = toggle;
    this.materialize = materialize;
  }
  override eq(other: Actions): boolean {
    return (
      this.entry.key === other.entry.key &&
      this.entry.reference === other.entry.reference &&
      this.expanded === other.expanded
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-fragment-actions";
    span.append(
      button(
        `${this.expanded ? "Collapse" : "Expand"} ${this.entry.reference}`,
        this.expanded ? "▾" : "▸",
        () => {
          this.toggle(view, this.entry);
        },
      ),
    );
    if (materializable(this.entry))
      span.append(
        button(`Materialize ${this.entry.reference}`, "◆", () => {
          this.materialize(view, this.entry);
        }),
      );
    return span;
  }
}

class Preview extends WidgetType {
  readonly entry: FragmentReference;
  readonly content: string;
  readonly files: readonly string[];
  readonly catalog: FragmentCatalog;
  constructor(
    entry: FragmentReference,
    content: string,
    files: readonly string[],
    catalog: FragmentCatalog,
  ) {
    super();
    this.entry = entry;
    this.content = content;
    this.files = files;
    this.catalog = catalog;
  }
  override eq(other: Preview): boolean {
    return (
      this.entry.reference === other.entry.reference &&
      this.content === other.content
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const section = document.createElement("section");
    section.className = "cm-fragment-content";
    const label = document.createElement("div");
    label.className = "cm-fragment-label";
    label.textContent = this.entry.reference;
    section.append(
      label,
      nestedContent(this.content, this.files, this.catalog, view),
    );
    return section;
  }
}

export interface FragmentSupport {
  readonly extensions: Extension;
  setFiles(view: EditorView, files: readonly string[]): void;
  expandAll(view: EditorView): Promise<void>;
  collapseAll(view: EditorView): void;
}

/** Collapsing is told from expanding by the caller, so nothing here reads the field. */
async function fragmentToggle(
  catalog: FragmentCatalog,
  view: EditorView,
  entry: FragmentReference,
  expanded: boolean,
): Promise<void> {
  try {
    if (expanded) {
      view.dispatch({ effects: changed.of({ key: entry.key, value: null }) });
      return;
    }
    const source = view.state.doc.toString();
    const { content } = await catalog.load(entry.reference);
    if (view.state.doc.toString() !== source)
      throw new Error("Draft changed while loading the preview. Try again.");
    view.dispatch({
      effects: changed.of({
        key: entry.key,
        value: { reference: entry.reference, content },
      }),
    });
  } catch (error) {
    catalog.onError(error);
  }
}

async function fragmentMaterialize(
  catalog: FragmentCatalog,
  view: EditorView,
  entry: FragmentReference,
): Promise<void> {
  try {
    const source = view.state.doc.toString();
    const { content } = await catalog.load(entry.reference);
    if (view.state.doc.toString() !== source)
      throw new Error(
        "Draft changed while loading the fragment. No edits applied.",
      );
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: materializedYaml(source, entry, content),
      },
      userEvent: "input.materialize",
    });
    view.focus();
  } catch (error) {
    catalog.onError(error);
  }
}

function fragmentDecorations(
  catalog: FragmentCatalog,
  state: EditorState,
  value: FragmentState,
): ReturnType<typeof Decoration.set> {
  const ranges = [];
  for (const entry of referenceNodes(state.doc.toString(), value.files)) {
    const stored = value.expanded.get(entry.key);
    const expanded = stored?.reference === entry.reference;
    ranges.push(
      Decoration.mark({
        class: "cm-project-file-reference",
        attributes: { "data-project-file": entry.reference },
      }).range(entry.from, entry.to),
    );
    const end = state.doc.lineAt(entry.to).to;
    ranges.push(
      Decoration.widget({
        widget: new Actions(
          entry,
          expanded,
          (view, held) => void fragmentToggle(catalog, view, held, expanded),
          (view, held) => void fragmentMaterialize(catalog, view, held),
        ),
        side: 1,
      }).range(end),
    );
    if (expanded && stored !== undefined)
      ranges.push(
        Decoration.widget({
          widget: new Preview(entry, stored.content, value.files, catalog),
          block: true,
          side: 2,
        }).range(end),
      );
  }
  return Decoration.set(ranges, true);
}

function fragmentApplied(
  value: FragmentState,
  updates: readonly FragmentChange[],
): FragmentState {
  const next: FragmentState = { ...value, expanded: new Map(value.expanded) };
  for (const update of updates) {
    if (update.files) next.files = update.files;
    if (update.clear) next.expanded.clear();
    if (update.key !== undefined) {
      if (update.value === null || update.value === undefined)
        next.expanded.delete(update.key);
      else next.expanded.set(update.key, update.value);
    }
  }
  return next;
}

function fragmentField(catalog: FragmentCatalog): StateField<FragmentState> {
  return StateField.define<FragmentState>({
    create() {
      return { files: [], expanded: new Map(), decorations: Decoration.none };
    },
    update(value, transaction) {
      const effects = transaction.effects.filter((effect) =>
        effect.is(changed),
      );
      if (!transaction.docChanged && !effects.length) return value;
      const next = fragmentApplied(
        value,
        effects.map((effect) => effect.value),
      );
      next.decorations = fragmentDecorations(catalog, transaction.state, next);
      return next;
    },
    provide: (held) =>
      EditorView.decorations.from(held, (value) => value.decorations),
  });
}

export function fragmentSupport(catalog: FragmentCatalog): FragmentSupport {
  const field = fragmentField(catalog);
  return {
    extensions: [
      field,
      autocompletion({
        override: [
          (context) =>
            fragmentCompletion(context.state.field(field).files)(context),
        ],
      }),
    ],
    setFiles(view, files) {
      view.dispatch({ effects: changed.of({ files, clear: true }) });
    },
    async expandAll(view) {
      await Promise.all(
        referenceNodes(
          view.state.doc.toString(),
          view.state.field(field).files,
        ).map((entry) => fragmentToggle(catalog, view, entry, false)),
      );
    },
    collapseAll(view) {
      view.dispatch({ effects: changed.of({ clear: true }) });
    },
  };
}
