export class TextNode {
  readonly textContent: string;
  constructor(textContent: string) {
    this.textContent = textContent;
  }
}

export class TestElement {
  readonly attributes = new Map<string, string>();
  readonly children: (TestElement | TextNode)[] = [];
  value = "";
  readonly listeners = new Map<
    string,
    (event: { preventDefault: () => void }) => void
  >();
  readonly styles = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string) => this.styles.set(name, value),
  };
  readonly tagName: string;
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  append(...children: (TestElement | TextNode)[]) {
    this.children.push(...children);
  }
  addEventListener(
    name: string,
    listener: (event: { preventDefault: () => void }) => void,
  ) {
    this.listeners.set(name, listener);
  }
}

Object.defineProperty(globalThis, "document", {
  value: {
    createElement: (tag: string) => new TestElement(tag),
    createTextNode: (value: string) => new TextNode(value),
  },
});

export function content(node: TestElement | TextNode): string {
  return node instanceof TextNode
    ? node.textContent
    : node.children.map(content).join("");
}

export function elements(node: TestElement, tag: string): TestElement[] {
  const nested = node.children.flatMap((child) =>
    child instanceof TestElement ? elements(child, tag) : [],
  );
  return node.tagName === tag ? [node, ...nested] : nested;
}
