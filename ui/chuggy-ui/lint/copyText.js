// `copy/no-literal-text`: what a reader is shown is the catalog's, so a
// component spells none of it. The rule reports text between tags that holds
// a letter, and a string or a template with a letter in its own text that is
// a child of an element or the value of an attribute a reader is shown. A
// value built some other way, such as a choice between two strings, is not
// read; a string with no letter, such as a separator or a number, is not copy.

/** The attributes whose value a reader is shown or hears. */
const copyAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "label",
  "placeholder",
  "title",
]);

const letter = /\p{L}/u;

/** Whether an expression is written-out text holding a letter. */
function copySpelled(expression) {
  if (expression.type === "Literal")
    return (
      typeof expression.value === "string" && letter.test(expression.value)
    );
  if (expression.type === "TemplateLiteral")
    return expression.quasis.some((quasi) =>
      letter.test(quasi.value.cooked ?? ""),
    );
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
const noLiteralText = {
  meta: {
    type: "problem",
    docs: {
      description:
        "copy a reader is shown comes from the catalog, not a literal",
    },
    messages: {
      text: "text a reader is shown comes from the copy catalog",
      attribute:
        "`{{name}}` is shown to a reader, so its text comes from the copy catalog",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXText(node) {
        if (letter.test(node.value))
          context.report({ node, messageId: "text" });
      },
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (parent.type === "JSXElement" || parent.type === "JSXFragment") {
          if (copySpelled(node.expression))
            context.report({ node, messageId: "text" });
        }
      },
      JSXAttribute(node) {
        const name =
          node.name.type === "JSXIdentifier" ? node.name.name : undefined;
        if (name === undefined || !copyAttributes.has(name)) return;
        const value = node.value;
        if (value === null) return;
        const expression =
          value.type === "JSXExpressionContainer" ? value.expression : value;
        if (copySpelled(expression))
          context.report({ node, messageId: "attribute", data: { name } });
      },
    };
  },
};

export const copyPlugin = { rules: { "no-literal-text": noLiteralText } };
