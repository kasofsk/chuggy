/**
 * Every axe finding the console's accessibility suites let pass, in a module
 * that imports nothing, so the primitives' suite and the rendered cases read
 * the one list. A finding is let pass when its rule is `rule` and the element
 * it names matches `selector`; anything else either suite finds fails it.
 */

export interface AccessibilityException {
  /** An axe rule id, as `axe.getRules()` names it. */
  readonly rule: string;
  /** A CSS selector the excepted element matches. */
  readonly selector: string;
  /** Why it is let pass rather than fixed. */
  readonly reason: string;
}

export const accessibilityExceptions: readonly AccessibilityException[] = [
  {
    rule: "region",
    selector: ".chat-separator",
    reason:
      "the handle between the page and the chat pane resizes both, so it sits between their landmarks rather than inside either",
  },
  {
    rule: "label-content-name-mismatch",
    selector: 'button[aria-label="Account menu"]',
    reason:
      "the trigger shows the member's initials and is named for the menu it opens; which words it should carry is a decision about the shell's copy",
  },
  {
    rule: "label-content-name-mismatch",
    selector: "button.ticket-list-standing",
    reason:
      "the dispatch button shows the ticket's state and is named for what pressing it does; reconciling the two is a change to the ticket row",
  },
  {
    rule: "label-content-name-mismatch",
    selector: ".epic-card-button",
    reason:
      "an epic graph's card is named by a sentence of its number, title and standing, and draws them as separate pieces in another order",
  },
  {
    rule: "label-content-name-mismatch",
    selector: ".epic-overview-graph",
    reason:
      "the overview's graph link is named for the graph and draws the epic's counts inside it",
  },
  {
    rule: "label-content-name-mismatch",
    selector: ".topbar-phone-item",
    reason:
      "a phone tab with a count draws the count before its label and is named with the label first",
  },
  {
    rule: "label-content-name-mismatch",
    selector: 'button[aria-label="Choose an icon file"]',
    reason:
      "the appearance page's file button draws a shorter word than the name it is given; the two are the page's copy to reconcile",
  },
  {
    rule: "heading-order",
    selector: ":is(.ticket-list-page, .epic-list-page) .record-row-title",
    reason:
      "the tickets and epics lists head their rows at level three under the page's level one, and changing the level is a change to every suite that reads it",
  },
  {
    rule: "heading-order",
    selector: ".epic-graph-side-heading",
    reason:
      "the graph's side lists are level four so they sit under the level-three ticket the side shows when one is chosen, and skip a level when none is",
  },
  {
    rule: "landmark-unique",
    selector: ".topbar-crumbs",
    reason:
      "the top bar's trail and a page header's back link are both named Breadcrumb; naming them apart is a decision about the shell's copy",
  },
  {
    rule: "landmark-unique",
    selector: "section:has(.tabular-scroll[role=region])",
    reason:
      "a settings listing's table scrolls in a region named by its caption, which is the listing's own heading",
  },
  {
    rule: "page-has-heading-one",
    selector: 'html:has(.settings[data-settings-at="index"])',
    reason:
      "the settings' own address heads its index's groups at level two and draws no level-one heading above them",
  },
];
