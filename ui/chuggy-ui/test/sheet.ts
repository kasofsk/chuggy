/**
 * A sheet as far as a suite with no layout can follow it: read rule by rule,
 * and matched against what a component draws. Whether what it declares then
 * fits a screen is a browser's to say, and no suite here runs one.
 */

/** The query the console's narrow width is, as tokens.css names it. */
export const sheetNarrowCondition = "(max-width: 40em)";

/**
 * Every style rule of a sheet that holds under the conditions named, in source
 * order: those outside any media or container query, and those inside one
 * whose condition is named.
 */
export function sheetRules(
  text: string,
  conditions: readonly string[],
): readonly CSSStyleRule[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  const rules: CSSStyleRule[] = [];
  const walk = (list: CSSRuleList): void => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) rules.push(rule);
      else if (
        rule instanceof CSSContainerRule ||
        rule instanceof CSSMediaRule
      ) {
        if (conditions.includes(rule.conditionText)) walk(rule.cssRules);
      } else if (rule instanceof CSSGroupingRule) walk(rule.cssRules);
    }
  };
  walk(sheet.cssRules);
  return rules;
}

/**
 * What rules declare for one element: the last matching declaration in source
 * order, which is the cascade where every rule competing for a property is one
 * class against one class.
 */
export function sheetDeclared(
  rules: readonly CSSStyleRule[],
  element: Element,
  property: string,
): string {
  let declared = "";
  for (const rule of rules) {
    const value = rule.style.getPropertyValue(property);
    if (value !== "" && element.matches(rule.selectorText)) declared = value;
  }
  return declared;
}
