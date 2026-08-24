import assert from "node:assert/strict";
import test from "node:test";

import { parseConfigurationsPage } from "../../ui/app/resources.js";

class TextNode {
  constructor(readonlyValue: string) {
    this.textContent = readonlyValue;
  }
  readonly textContent: string;
}

class TestElement {
  readonly attributes = new Map<string, string>();
  readonly children: (TestElement | TextNode)[] = [];
  readonly style = { setProperty: () => undefined };
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  readonly tagName: string;
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  append(...children: (TestElement | TextNode)[]) {
    this.children.push(...children);
  }
}

Object.defineProperty(globalThis, "document", {
  value: {
    createElement: (tag: string) => new TestElement(tag),
    createTextNode: (value: string) => new TextNode(value),
  },
});

const presentationModule = "../../ui/dom/configurationRegistry.js";
const { configurationRegistry } = (await import(presentationModule)) as {
  configurationRegistry: (state: unknown) => unknown;
};

function content(node: TestElement | TextNode): string {
  return node instanceof TextNode
    ? node.textContent
    : node.children.map(content).join("");
}

function elements(node: TestElement, tag: string): TestElement[] {
  const nested = node.children.flatMap((child) =>
    child instanceof TestElement ? elements(child, tag) : [],
  );
  return node.tagName === tag ? [node, ...nested] : nested;
}

test("loading, error, and empty registry states are explicit", () => {
  const loading = configurationRegistry({
    state: "Loading",
    held: undefined,
    load: "Initial",
  }) as TestElement;
  const error = configurationRegistry({
    state: "Error",
    held: undefined,
    error: { kind: "Unavailable", reason: "Configurations could not be read." },
  }) as TestElement;
  const empty = configurationRegistry({
    state: "Data",
    ...parseConfigurationsPage({ configurations: [] }),
  }) as TestElement;
  assert.equal(loading.attributes.get("aria-live"), "polite");
  assert.equal(error.attributes.get("aria-live"), "assertive");
  assert.match(content(empty), /No ticket configurations/);
});

test("a repository revision presents its ticket and task configuration", () => {
  const commit = "a".repeat(40);
  const declarationPath = [".chug", "configurations", "work.json"].join("/");
  const page = parseConfigurationsPage({
    configurations: [
      {
        revision: "revision-2",
        parent: "revision-1",
        digest: "digest-2",
        createdAt: "2026-08-24T12:00:00Z",
        readiness: "Ready",
        image: "worker:v2",
        practices: ["RegressionCoverage"],
        workInstructionsCount: 2,
        reviewInstructionsCount: 1,
        provenance: {
          source: "Repository",
          repository: "chuggy",
          commit,
          path: declarationPath,
          name: "work",
        },
      },
    ],
  });
  const registry = configurationRegistry({
    state: "Data",
    ...page,
  }) as TestElement;
  const rendered = content(registry);
  assert.match(rendered, /workReady/);
  assert.match(rendered, /Work2worker:v2RegressionCoverage/);
  assert.match(rendered, /Evaluation1worker:v2RegressionCoverage/);
  assert.match(rendered, new RegExp(commit));
  assert.match(rendered, new RegExp(declarationPath.replaceAll(".", "\\.")));
  assert.deepEqual(
    elements(registry, "th").map((heading) => heading.attributes.get("scope")),
    ["col", "col", "col", "col", "row", "row"],
  );
});

test("an incomplete authored revision names its unusable state", () => {
  const page = parseConfigurationsPage({
    configurations: [
      {
        revision: "draft-revision",
        digest: "draft-digest",
        createdAt: "2026-08-24T12:00:00Z",
        readiness: "Incomplete",
        provenance: { source: "Authored" },
      },
    ],
  });
  const registry = configurationRegistry({
    state: "Data",
    ...page,
  }) as TestElement;
  assert.match(content(registry), /Authored in Chuggy/);
  assert.match(content(registry), /cannot be used by a ticket/);
  assert.equal(elements(registry, "table").length, 0);
});

test("a failed refresh keeps visible configurations and announces the failure", () => {
  const held = parseConfigurationsPage({
    configurations: [
      {
        revision: "held-revision",
        digest: "held-digest",
        createdAt: "2026-08-24T12:00:00Z",
        readiness: "Incomplete",
        provenance: { source: "Authored" },
      },
    ],
  });
  const registry = configurationRegistry({
    state: "Error",
    held,
    error: { kind: "Unavailable", reason: "Refresh failed." },
  }) as TestElement;
  assert.match(content(registry), /Refresh failed/);
  assert.match(content(registry), /held-revision/);
  assert.equal(elements(registry, "p")[0]?.attributes.get("role"), "alert");
});
