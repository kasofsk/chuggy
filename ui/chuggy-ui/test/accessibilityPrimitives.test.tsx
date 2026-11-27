/**
 * axe over every primitive under `app/browser/ui/`, each drawn in its
 * variants and states, with the findings `accessibilityExceptions.ts` lists
 * let pass. The folder is read, so a primitive added without a case fails the
 * roster case here rather than going unchecked.
 *
 * jsdom lays nothing out and paints nothing, so the rules that read a box,
 * a scroll or a colour are off here and the rendered cases are where they
 * run; so are the rules that judge a whole document, since a primitive drawn
 * alone is not a page.
 */

import axe from "axe-core";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { DropdownMenu } from "radix-ui";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { Breadcrumb, BreadcrumbLink } from "../app/browser/ui/Breadcrumb.tsx";
import {
  Button,
  ButtonLink,
  buttonSizes,
  buttonVariants,
} from "../app/browser/ui/Button.tsx";
import { CenteredPage } from "../app/browser/ui/CenteredPage.tsx";
import { Checkbox } from "../app/browser/ui/Checkbox.tsx";
import { Chevron } from "../app/browser/ui/Chevron.tsx";
import { Chip } from "../app/browser/ui/Chip.tsx";
import { Confirm } from "../app/browser/ui/Confirm.tsx";
import { ConfirmDialog } from "../app/browser/ui/ConfirmDialog.tsx";
import { CopyBox, copyBoxBreaks } from "../app/browser/ui/CopyBox.tsx";
import { CopyButton, CopySaid } from "../app/browser/ui/CopyButton.tsx";
import { CountBadge } from "../app/browser/ui/CountBadge.tsx";
import { Dialog } from "../app/browser/ui/Dialog.tsx";
import { Disclosure } from "../app/browser/ui/Disclosure.tsx";
import {
  EmptyState,
  emptyHeadingLevels,
  emptyVariants,
} from "../app/browser/ui/EmptyState.tsx";
import { ExternalLink } from "../app/browser/ui/ExternalLink.tsx";
import { Field, Fields, fieldsVariants } from "../app/browser/ui/Fields.tsx";
import { Figure } from "../app/browser/ui/Figure.tsx";
import { FormField } from "../app/browser/ui/FormField.tsx";
import { Identity, identityForms } from "../app/browser/ui/Identity.tsx";
import { Input } from "../app/browser/ui/Input.tsx";
import {
  Ledger,
  LedgerBlock,
  LedgerGroup,
  LedgerRow,
  ledgerStandings,
} from "../app/browser/ui/Ledger.tsx";
import { Lightbox } from "../app/browser/ui/Lightbox.tsx";
import { LinePart } from "../app/browser/ui/LinePart.tsx";
import {
  ListControls,
  ListGlyph,
  ListSearch,
  listFilterGlyph,
  listSortGlyph,
} from "../app/browser/ui/ListControls.tsx";
import { ListFilter, ListFilterMarks } from "../app/browser/ui/ListFilter.tsx";
import { Locomotive } from "../app/browser/ui/Locomotive.tsx";
import { MarkdownReport } from "../app/browser/ui/MarkdownReport.tsx";
import { MenuContent, menuItemClassName } from "../app/browser/ui/Menu.tsx";
import { MoreMenu } from "../app/browser/ui/MoreMenu.tsx";
import { Notice, noticeTones } from "../app/browser/ui/Notice.tsx";
import {
  OfferedAction,
  actionForms,
} from "../app/browser/ui/OfferedAction.tsx";
import { PageHeader } from "../app/browser/ui/PageHeader.tsx";
import { Panel, panelVariants } from "../app/browser/ui/Panel.tsx";
import { Picker } from "../app/browser/ui/Picker.tsx";
import { RadioGroup } from "../app/browser/ui/RadioGroup.tsx";
import {
  RecordList,
  RecordRow,
  RecordRowSkeleton,
} from "../app/browser/ui/RecordList.tsx";
import { SearchableRoster } from "../app/browser/ui/SearchableRoster.tsx";
import { Select } from "../app/browser/ui/Select.tsx";
import { SettingsSection } from "../app/browser/ui/SettingsSection.tsx";
import { Skeleton, skeletonShapes } from "../app/browser/ui/Skeleton.tsx";
import {
  StatusBadge,
  statusBadgeSizes,
  statusBadgeTones,
} from "../app/browser/ui/StatusBadge.tsx";
import { Switch } from "../app/browser/ui/Switch.tsx";
import { TabNav, TabNavLink } from "../app/browser/ui/TabNav.tsx";
import { Table } from "../app/browser/ui/Table.tsx";
import { TextLink } from "../app/browser/ui/TextLink.tsx";
import { Textarea } from "../app/browser/ui/Textarea.tsx";
import { TicketReference } from "../app/browser/ui/TicketReference.tsx";
import { Toasts, toastTones } from "../app/browser/ui/Toast.tsx";
import { ToggleGroup } from "../app/browser/ui/ToggleGroup.tsx";
import { Tooltip } from "../app/browser/ui/Tooltip.tsx";
import { WordDetail } from "../app/browser/ui/WordDetail.tsx";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import { TicketReferenceProvider } from "../app/browser/ui/ticketReferenceHeld.tsx";
import type { TicketReferenceHeld } from "../app/browser/ui/ticketReferenceHeld.tsx";
import { accessibilityExceptions } from "./accessibilityExceptions.ts";
import type { AccessibilityException } from "./accessibilityExceptions.ts";
import { renderCopied } from "./copied.tsx";
import { intersectionObserverStubbed } from "./intersectionObserver.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";

vi.mock("@tanstack/react-router", () => import("./routerLinkStubbed.tsx"));

beforeEach(() => {
  resizeObserverStubbed();
  intersectionObserverStubbed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The rules that read a laid-out box, a scroll extent or a painted colour,
 * none of which jsdom has, and those that judge a whole document. */
const primitivesRulesOff = [
  "color-contrast",
  "link-in-text-block",
  "target-size",
  "scrollable-region-focusable",
  "document-title",
  "html-has-lang",
  "landmark-one-main",
  "page-has-heading-one",
  "region",
  "bypass",
];

/** Every finding axe makes on the document as it stands, as `rule target`,
 * but those `exceptions` let pass. */
async function primitivesFindings(
  exceptions: readonly AccessibilityException[] = accessibilityExceptions,
): Promise<readonly string[]> {
  const results = await axe.run(document, {
    rules: Object.fromEntries(
      primitivesRulesOff.map((rule) => [rule, { enabled: false }]),
    ),
    resultTypes: ["violations"],
  });
  return results.violations.flatMap((violation) =>
    violation.nodes
      .filter((node) => {
        const element =
          node.target.length === 1
            ? document.querySelector(String(node.target[0]))
            : null;
        return !exceptions.some(
          (exception) =>
            exception.rule === violation.id &&
            element?.matches(exception.selector) === true,
        );
      })
      .map((node) => `${violation.id} ${node.target.join(" ")}`),
  );
}

/** One state of a primitive: what is drawn, and what is done to it before it
 * is judged, such as opening what it opens. */
interface PrimitiveCase {
  readonly state: string;
  readonly drawn: ReactNode;
  readonly then?: () => Promise<void>;
}

const nothing = (): void => undefined;

/** Presses the button `name`, by a click or, for a menu, the arrow a
 * keyboard opens it with, and waits for what it opens, by `role`. */
async function primitivesPressed(
  name: string | RegExp,
  role: string,
): Promise<void> {
  const trigger = screen.getByRole("button", { name });
  await act(async () => {
    if (role === "menu") fireEvent.keyDown(trigger, { key: "ArrowDown" });
    else fireEvent.click(trigger);
    await Promise.resolve();
  });
  await screen.findByRole(role);
}

/** Focuses the button `name` and waits for the tooltip it shows. */
async function primitivesFocused(name: string): Promise<void> {
  await act(async () => {
    fireEvent.focus(screen.getByRole("button", { name }));
    await Promise.resolve();
  });
  await screen.findByRole("tooltip");
}

const link = { to: "/" } as const;

const when = {
  kind: "Instant",
  text: "10:12",
  iso: "2026-08-27T10:12:00.000Z",
} as const;

const spent = {
  cost: { kind: "Cost", text: "$0.42", basis: { id: "figures-basis-list" } },
  tokens: { kind: "Tokens", text: "9.1k", unit: { id: "figures-tokens" } },
} as const;

const tickets: TicketReferenceHeld = {
  factsOf: (ticket) =>
    ticket === 15 ? { title: "Fix the thing", phase: "Work" } : undefined,
  hrefOf: (ticket) => `/acme/web/tickets/${String(ticket)}`,
  open: nothing,
};

const report = [
  "# Report",
  "",
  "A paragraph with `code`, **weight**, a [link](https://example.com) and [[ticket:15]].",
  "",
  "- one",
  "- two",
  "",
  "> quoted",
  "",
  "```ts",
  "const a = 1;",
  "```",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
].join("\n");

const options = [
  { value: "one", text: "One" },
  { value: "two", text: "Two" },
];

const primitiveCases: Readonly<Record<string, readonly PrimitiveCase[]>> = {
  Breadcrumb: [
    {
      state: "a crumb back",
      drawn: (
        <Breadcrumb>
          <BreadcrumbLink {...link}>Tickets</BreadcrumbLink>
        </Breadcrumb>
      ),
    },
  ],
  Button: [
    ...buttonVariants.flatMap((variant) =>
      buttonSizes.map((size) => ({
        state: `${variant} at ${size}`,
        drawn: (
          <Button
            variant={variant}
            size={size}
            onClick={nothing}
            {...(size === "icon" ? { named: "Close" } : {})}
          >
            {size === "icon" ? <Chevron className="chevron" /> : "Save"}
          </Button>
        ),
      })),
    ),
    {
      state: "pressed, busy, disabled and expanded",
      drawn: (
        <>
          <Button pressed onClick={nothing}>
            Pinned
          </Button>
          <Button busy onClick={nothing}>
            Saving
          </Button>
          <Button disabled onClick={nothing}>
            Locked
          </Button>
          <Button expanded onClick={nothing}>
            More
          </Button>
        </>
      ),
    },
    {
      state: "a link",
      drawn: <ButtonLink {...link}>Open</ButtonLink>,
    },
  ],
  CenteredPage: [true, false].map((landmark) => ({
    state: landmark ? "the document's landmark" : "inside another",
    drawn: (
      <CenteredPage
        landmark={landmark}
        title="Sign in"
        primary={<Button onClick={nothing}>Sign in</Button>}
        secondary={<Button onClick={nothing}>Back</Button>}
      >
        <p>Why you are here.</p>
      </CenteredPage>
    ),
  })),
  Checkbox: [
    {
      state: "unchecked",
      drawn: <Checkbox label="Notify" checked={false} onChange={nothing} />,
    },
    {
      state: "checked",
      drawn: <Checkbox label="Notify" checked onChange={nothing} />,
    },
    {
      state: "disabled",
      drawn: <Checkbox label="Notify" checked disabled onChange={nothing} />,
    },
    {
      state: "held",
      drawn: <Checkbox label="Notify" checked held onChange={nothing} />,
    },
    {
      state: "bare",
      drawn: (
        <Checkbox label="Notify" checked={false} bare onChange={nothing} />
      ),
    },
  ],
  Chevron: [{ state: "decoration", drawn: <Chevron className="chevron" /> }],
  Chip: [
    { state: "plain", drawn: <Chip>main</Chip> },
    {
      state: "removable",
      drawn: (
        <Chip removal={{ name: "Remove main", onRemove: nothing }}>main</Chip>
      ),
    },
    {
      state: "removal disabled",
      drawn: (
        <Chip
          removal={{ name: "Remove main", onRemove: nothing, disabled: true }}
        >
          main
        </Chip>
      ),
    },
  ],
  Confirm: [false, true].map((busy) => ({
    state: busy ? "busy" : "asking",
    drawn: (
      <Confirm
        question="Delete it?"
        confirm="Delete"
        busy={busy}
        onConfirm={nothing}
        onCancel={nothing}
      >
        <Button onClick={nothing}>Delete</Button>
      </Confirm>
    ),
  })),
  ConfirmDialog: [false, true].map((danger) => ({
    state: danger ? "open, dangerous" : "open",
    drawn: (
      <ConfirmDialog
        title="Delete the project?"
        confirm="Delete"
        danger={danger}
        open
        onOpenChange={nothing}
        onConfirm={nothing}
      >
        <p>It cannot be undone.</p>
      </ConfirmDialog>
    ),
  })),
  CopyBox: copyBoxBreaks.flatMap((breaks) =>
    [false, true].map((folded) => ({
      state: `${breaks}${folded ? ", folded" : ""}`,
      drawn: (
        <CopyProvider write={() => Promise.resolve(true)}>
          <CopyBox
            about="The command"
            text="npm ci"
            copyLabel="Copy the command"
            breaks={breaks}
            folded={folded}
          />
        </CopyProvider>
      ),
    })),
  ),
  CopyButton: [
    ...[false, true].map((worded) => ({
      state: worded ? "worded" : "an icon",
      drawn: (
        <CopyProvider write={() => Promise.resolve(true)}>
          <CopyButton text="npm ci" label="Copy the command" worded={worded} />
        </CopyProvider>
      ),
    })),
    { state: "said", drawn: <CopySaid copied worded /> },
  ],
  CountBadge: [
    { state: "a count", drawn: <CountBadge count={3} name="Runs" /> },
    { state: "cut", drawn: <CountBadge count={99} cut name="Runs" /> },
  ],
  Dialog: (["roster", "form", "image"] as const).map((size) => ({
    state: `open at ${size}`,
    drawn: (
      <Dialog
        title="Invite"
        size={size}
        open
        onOpenChange={nothing}
        note="Sent by email"
        foot={<Button onClick={nothing}>Send</Button>}
      >
        <p>Who to invite.</p>
      </Dialog>
    ),
  })),
  Disclosure: [false, true].map((open) => ({
    state: open ? "open" : "closed",
    drawn: (
      <Disclosure
        open={open}
        onOpenChange={nothing}
        label="Details"
        chevron
        look={{ variant: "quiet", size: "sm" }}
      >
        <p>Hidden detail</p>
      </Disclosure>
    ),
  })),
  EmptyState: emptyVariants.flatMap((variant) =>
    emptyHeadingLevels.map((level) => ({
      state: `${variant} at level ${String(level)}`,
      drawn: (
        <EmptyState
          label="Nothing has run"
          variant={variant}
          level={level}
          detail="Runs appear here."
          action={<Button onClick={nothing}>Run</Button>}
        />
      ),
    })),
  ),
  Fields: fieldsVariants.map((variant) => ({
    state: variant,
    drawn: (
      <Fields variant={variant}>
        <Field name="Branch">main</Field>
        <Field name="Links" absent>
          None
        </Field>
      </Fields>
    ),
  })),
  ExternalLink: [
    {
      state: "a link",
      drawn: (
        <p>
          <ExternalLink href="https://policies.example/terms">
            Terms of Service
          </ExternalLink>
        </p>
      ),
    },
  ],
  Figure: [
    { state: "a cost", drawn: <Figure figure={spent.cost} /> },
    { state: "tokens", drawn: <Figure figure={spent.tokens} /> },
    { state: "an instant", drawn: <Figure figure={when} /> },
    {
      state: "a duration",
      drawn: <Figure figure={{ kind: "Duration", text: "4m 12s" }} />,
    },
  ],
  FormField: [
    {
      state: "plain",
      drawn: (
        <FormField label="Name">
          {(bound) => (
            <input id={bound.id} aria-describedby={bound.describedBy} />
          )}
        </FormField>
      ),
    },
    {
      state: "hinted, required and refused",
      drawn: (
        <FormField
          label="Name"
          hint="As it is shown"
          required
          error="A name is needed"
          invalid
        >
          {(bound) => (
            <input
              id={bound.id}
              aria-describedby={bound.describedBy}
              aria-invalid={bound.invalid}
              required={bound.required}
            />
          )}
        </FormField>
      ),
    },
  ],
  Identity: identityForms.map((form) => ({
    state: form,
    drawn: (
      <Identity
        label={{ text: "cfaca0a", title: "cfaca0a1b2c3" }}
        block={form === "block"}
      />
    ),
  })),
  Input: [
    {
      state: "labelled by name",
      drawn: <Input label="Name" value="" onChange={nothing} />,
    },
    {
      state: "shown, hinted and refused",
      drawn: (
        <Input
          label="Name"
          value="x"
          onChange={nothing}
          labelShown
          hint="As shown"
          error="Too short"
          invalid
        />
      ),
    },
    {
      state: "numeric with a unit",
      drawn: (
        <Input
          label="Limit"
          value="3"
          unit="runs"
          numeric
          onChange={nothing}
          labelShown
        />
      ),
    },
    {
      state: "read only",
      drawn: (
        <Input label="Origin" value="https://example.com" readOnly labelShown />
      ),
    },
    {
      state: "disabled",
      drawn: (
        <Input label="Name" value="x" disabled onChange={nothing} labelShown />
      ),
    },
  ],
  Ledger: [
    ...ledgerStandings.map((standing) => ({
      state: `a ${standing} group`,
      drawn: (
        <Ledger truncated="Older cycles are not shown">
          <LedgerGroup
            title="Cycle 3"
            standing={standing}
            summary="Work passed"
            open={standing === "Current"}
          >
            <LedgerBlock
              eyebrow="Evaluation"
              pill={{ tone: "live", text: "Current" }}
            >
              <LedgerRow
                label="Stage 1 of 2"
                identity={{ text: "b8bd…-7", title: "execution-b8bdfdd4-7" }}
                pill={{ tone: "fail", text: "Failed" }}
                when={when}
                spent={spent}
                note="Relaunched"
              />
              <LedgerRow
                label="Stage 2 of 2"
                pill={{ tone: "retired", text: "Skipped" }}
                ghost
              />
              <LedgerRow
                label="Work"
                pill={{ tone: "pass", text: "Passed" }}
                changed
                expands={[
                  {
                    label: "Details",
                    hide: "Hide",
                    open: true,
                    onToggle: nothing,
                    children: <p>Detail</p>,
                  },
                ]}
              />
            </LedgerBlock>
          </LedgerGroup>
        </Ledger>
      ),
    })),
  ],
  Lightbox: [
    {
      state: "closed",
      drawn: <Lightbox src="/a.png" alt="The banner" className="banner" />,
    },
    {
      state: "open",
      drawn: <Lightbox src="/a.png" alt="The banner" className="banner" />,
      then: () => primitivesPressed("The banner", "dialog"),
    },
  ],
  LinePart: [
    {
      state: "first and after",
      drawn: (
        <p>
          <LinePart first>One</LinePart>
          <LinePart>Two</LinePart>
        </p>
      ),
    },
  ],
  ListControls: [
    {
      state: "a search and glyphs",
      drawn: (
        <ListControls>
          <ListSearch
            label="Search tickets"
            placeholder="Titles…"
            search=""
            onSearch={nothing}
          />
          <Button size="icon" named="Sort" onClick={nothing}>
            <ListGlyph>{listSortGlyph}</ListGlyph>
          </Button>
          <Button size="icon" named="Filter" onClick={nothing}>
            <ListGlyph>{listFilterGlyph}</ListGlyph>
          </Button>
        </ListControls>
      ),
    },
    {
      state: "the search open",
      drawn: (
        <ListControls>
          <ListSearch
            label="Search tickets"
            placeholder="Titles…"
            search="lost"
            onSearch={nothing}
          />
        </ListControls>
      ),
      then: async () => {
        const toggle = screen.getByRole("button", { name: "Search tickets" });
        await act(async () => {
          fireEvent.click(toggle);
          await Promise.resolve();
        });
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
      },
    },
  ],
  ListFilter: [false, true]
    .flatMap((wide) => [
      {
        state: `${wide ? "wide" : "narrow"}, closed`,
        drawn: (
          <ListFilter
            label="Filter"
            wide={wide}
            marks={[
              { key: "s", field: "State", value: "Ready", onRemove: nothing },
            ]}
            onClear={nothing}
          >
            <Checkbox label="Ready" checked onChange={nothing} />
          </ListFilter>
        ),
      },
      {
        state: `${wide ? "wide" : "narrow"}, open`,
        drawn: (
          <ListFilter label="Filter" wide={wide} marks={[]} onClear={nothing}>
            <Checkbox label="Ready" checked onChange={nothing} />
          </ListFilter>
        ),
        then: () => primitivesPressed(/^Filter/u, "dialog"),
      },
    ])
    .concat([
      {
        state: "marks alone",
        drawn: (
          <ListFilterMarks
            label="Filtered by"
            marks={[
              { key: "s", field: "State", value: "Ready", onRemove: nothing },
            ]}
          />
        ),
      },
    ]),
  Locomotive: [{ state: "drawn", drawn: <Locomotive /> }],
  MarkdownBlocks: [
    {
      state: "every block a report draws",
      drawn: <MarkdownReport text={report} />,
    },
  ],
  MarkdownCode: [
    {
      state: "a fenced block",
      drawn: <MarkdownReport text={"```ts\nconst a = 1;\n```"} bare />,
    },
  ],
  MarkdownReport: [
    { state: "framed", drawn: <MarkdownReport text={report} /> },
    {
      state: "bare, writing",
      drawn: <MarkdownReport text={report} bare writing />,
    },
    { state: "cut", drawn: <MarkdownReport text={report} cut /> },
  ],
  Menu: [
    {
      state: "open",
      drawn: (
        <DropdownMenu.Root open modal={false}>
          <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <MenuContent>
              <DropdownMenu.Item className={menuItemClassName}>
                Rename
              </DropdownMenu.Item>
            </MenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ),
    },
  ],
  MoreMenu: [
    {
      state: "open, with a link, an action and a destructive one",
      drawn: (
        <MoreMenu
          label="More actions"
          items={[
            {
              kind: "link",
              label: "Open",
              link: (anchor) => (
                <a href="/x" className={anchor.className}>
                  {anchor.children}
                </a>
              ),
            },
            { kind: "action", label: "Rename", onSelect: nothing },
            {
              kind: "action",
              label: "Archive",
              onSelect: nothing,
              disabled: true,
            },
            { kind: "destructive", label: "Delete", onSelect: nothing },
          ]}
        />
      ),
      then: () => primitivesPressed("More actions", "menu"),
    },
  ],
  Notice: noticeTones.flatMap((tone) =>
    [false, true].map((inline) => ({
      state: `${tone}${inline ? ", inline" : ""}`,
      drawn: (
        <Notice
          tone={tone}
          inline={inline}
          heading="Heads up"
          detail="Something changed."
          more="Read more"
        />
      ),
    })),
  ),
  OfferedAction: actionForms.flatMap((variant) => [
    {
      state: `${variant}, ready`,
      drawn: (
        <OfferedAction
          action="Merge"
          effect="Lands the change"
          variant={variant}
          onChoose={nothing}
        />
      ),
    },
    {
      state: `${variant}, busy`,
      drawn: (
        <OfferedAction
          action="Merge"
          effect="Lands the change"
          variant={variant}
          busy
          onChoose={nothing}
        />
      ),
    },
    {
      state: `${variant}, refused`,
      drawn: (
        <OfferedAction
          action="Merge"
          effect="Lands the change"
          variant={variant}
          refusedBecause="Checks are red"
          onChoose={nothing}
        />
      ),
    },
    {
      state: `${variant}, primary and dangerous`,
      drawn: (
        <OfferedAction
          action="Delete"
          effect="Removes it"
          more="It cannot be undone"
          variant={variant}
          primary
          danger
          onChoose={nothing}
        />
      ),
    },
  ]),
  PageHeader: [
    { state: "a title", drawn: <PageHeader title="Tickets" /> },
    {
      state: "every part",
      drawn: (
        <PageHeader
          title="Fix the thing"
          number={7}
          back={{ label: "Tickets", link }}
          status={
            <StatusBadge tone="live" size="regular">
              Working
            </StatusBadge>
          }
          statusCondensed={
            <StatusBadge tone="live" size="small">
              Working
            </StatusBadge>
          }
          description="A ticket"
          meta={<span>Opened today</span>}
          primary={{ label: "Merge", onPress: nothing }}
          secondary={[
            { label: "Edit", onPress: nothing },
            { label: "Duplicate", link },
          ]}
          overflow={
            <MoreMenu
              label="More actions"
              items={[{ kind: "action", label: "Rename", onSelect: nothing }]}
            />
          }
        />
      ),
    },
  ],
  Panel: [
    ...panelVariants.flatMap((variant) =>
      ([2, 3] as const).map((level) => ({
        state: `${variant} at level ${String(level)}`,
        drawn: (
          <Panel
            title="Runs"
            about="Every run"
            meta={<span>3</span>}
            foot={<Button onClick={nothing}>More</Button>}
            variant={variant}
            level={level}
          >
            <p>Body</p>
          </Panel>
        ),
      })),
    ),
    ...[false, true].map((open) => ({
      state: `collapsible, ${open ? "open" : "closed"}`,
      drawn: (
        <Panel title="Runs" collapsible={{ open, onOpenChange: nothing }}>
          <p>Body</p>
        </Panel>
      ),
    })),
  ],
  Picker: [
    {
      state: "closed",
      drawn: (
        <Picker
          label="Model"
          value="one"
          options={options}
          onChoose={nothing}
        />
      ),
    },
    {
      state: "open with actions",
      drawn: (
        <Picker
          label="Model"
          value="one"
          options={options}
          onChoose={nothing}
          actions={[{ text: "Manage", onSelect: nothing }]}
          hint="The default"
        />
      ),
      then: () => primitivesPressed(/Model/u, "menu"),
    },
  ],
  RadioGroup: [
    {
      state: "chosen",
      drawn: (
        <RadioGroup
          label="Mode"
          value="one"
          options={[
            ...options,
            {
              value: "three",
              text: "Three",
              description: "Not now",
              disabled: true,
            },
          ]}
          onChoose={nothing}
        />
      ),
    },
    {
      state: "disabled",
      drawn: (
        <RadioGroup
          label="Mode"
          value="one"
          options={options}
          disabled
          onChoose={nothing}
        />
      ),
    },
  ],
  RecordList: [
    {
      state: "rows, a skeleton and more",
      drawn: (
        <>
          <h1>Tickets</h1>
          <RecordList
            label="Tickets"
            more={{ label: "Show more", onMore: nothing }}
          >
            <RecordRow
              title="Fix the thing"
              link={link}
              level={2}
              meta={<span>#7</span>}
              trailing={
                <StatusBadge tone="pass" size="small">
                  Done
                </StatusBadge>
              }
              foot={<span>Today</span>}
            />
            <RecordRowSkeleton />
          </RecordList>
        </>
      ),
    },
    {
      state: "more, busy",
      drawn: (
        <RecordList
          label="Tickets"
          more={{ label: "Show more", onMore: nothing, busy: true }}
        >
          <RecordRow title="Fix the thing" link={link} level={2} />
        </RecordList>
      ),
    },
  ],
  SearchableRoster: [
    {
      state: "a roster",
      drawn: (
        <SearchableRoster
          label="Search people"
          rows={["Ada", "Grace"]}
          textOf={(row) => row}
          keyOf={(row) => row}
          renderRow={(row) => <span>{row}</span>}
        />
      ),
    },
  ],
  Select: [
    {
      state: "named",
      drawn: (
        <Select
          label="Region"
          value="one"
          options={options}
          onChange={nothing}
        />
      ),
    },
    {
      state: "shown, refused",
      drawn: (
        <Select
          label="Region"
          value="one"
          options={options}
          onChange={nothing}
          labelShown
          error="Pick another"
          invalid
        />
      ),
    },
    {
      state: "disabled",
      drawn: (
        <Select
          label="Region"
          value="one"
          options={options}
          onChange={nothing}
          disabled
          labelShown
        />
      ),
    },
  ],
  SettingsSection: [false, true]
    .flatMap((editing) =>
      [false, true].map((saving) => ({
        state: `${editing ? "editing" : "reading"}${saving ? ", saving" : ""}`,
        drawn: (
          <SettingsSection
            title="Limits"
            about="What a run may spend"
            editing={editing}
            editable
            changed={editing}
            saving={saving}
            footLead={<span>Saved today</span>}
            onEdit={nothing}
            onCancel={nothing}
            onSave={nothing}
            onReload={nothing}
          >
            <Input label="Limit" value="3" onChange={nothing} labelShown />
          </SettingsSection>
        ),
      })),
    )
    .concat([
      {
        state: "refused",
        drawn: (
          <SettingsSection
            title="Limits"
            about="What a run may spend"
            editing
            editable
            changed
            saving={false}
            refusal={{
              at: "Section",
              refused: new Error("refused"),
              line: <span>It was refused</span>,
            }}
            footLead={null}
            onEdit={nothing}
            onCancel={nothing}
            onSave={nothing}
          >
            <Input label="Limit" value="3" onChange={nothing} labelShown />
          </SettingsSection>
        ),
      },
    ]),
  Skeleton: skeletonShapes.map((shape) => ({
    state: shape,
    drawn: <Skeleton shape={shape} label="Loading" />,
  })),
  StatusBadge: statusBadgeSizes
    .flatMap((size) =>
      statusBadgeTones.map((tone) => ({
        state: `${tone} at ${size}`,
        drawn: (
          <StatusBadge tone={tone} size={size}>
            {tone}
          </StatusBadge>
        ),
      })),
    )
    .concat([
      {
        state: "compact",
        drawn: (
          <StatusBadge tone="pass" size="small" compact>
            Done
          </StatusBadge>
        ),
      },
    ]),
  Switch: [
    {
      state: "off",
      drawn: <Switch label="Notify" checked={false} onChange={nothing} />,
    },
    {
      state: "on, with what it does",
      drawn: (
        <Switch
          label="Notify"
          checked
          about="Mails each landing."
          onChange={nothing}
        />
      ),
    },
    {
      state: "disabled",
      drawn: <Switch label="Notify" checked disabled onChange={nothing} />,
    },
  ],
  TabNav: [
    {
      state: "a current tab and a count",
      drawn: (
        <TabNav label="Ticket">
          <TabNavLink {...link} aria-current="page">
            Overview
          </TabNavLink>
          <TabNavLink {...link} count={3} countCut>
            Runs
          </TabNavLink>
        </TabNav>
      ),
    },
  ],
  Table: [
    {
      state: "a table",
      drawn: (
        <Table caption="Runs">
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">7</th>
              <td>Passed</td>
            </tr>
          </tbody>
        </Table>
      ),
    },
    ...[false, true].map((framed) => ({
      state: `stacked${framed ? ", framed" : ""}`,
      drawn: (
        <Table
          caption="People"
          stacked={{
            framed,
            columns: [
              { key: "name", label: "Name", rowHeader: true },
              { key: "runs", label: "Runs", numeric: true },
              {
                key: "act",
                label: "Actions",
                labelHidden: true,
                actions: true,
              },
            ],
            rows: [
              {
                key: "ada",
                cells: {
                  name: "Ada",
                  runs: "3",
                  act: <Button onClick={nothing}>Remove</Button>,
                },
              },
              {
                key: "grace",
                cells: { name: "Grace", runs: "", act: null },
                empty: ["runs"],
              },
            ],
          }}
        />
      ),
    })),
  ],
  TextLink: [
    {
      state: "a link",
      drawn: (
        <p>
          <TextLink {...link}>the docs</TextLink>
        </p>
      ),
    },
  ],
  Textarea: [
    {
      state: "named",
      drawn: <Textarea label="Notes" value="" onChange={nothing} />,
    },
    {
      state: "shown, mono, refused",
      drawn: (
        <Textarea
          label="Notes"
          value="x"
          onChange={nothing}
          mono
          invalid
          labelShown
          error="Too short"
          hint="Markdown"
        />
      ),
    },
  ],
  TicketReference: [
    { state: "with nothing held", drawn: <TicketReference ticket={15} /> },
    {
      state: "held, with a title",
      drawn: (
        <TicketReferenceProvider held={tickets}>
          <TicketReference ticket={15} title="Fix the thing" />
        </TicketReferenceProvider>
      ),
    },
  ],
  Toast: [
    {
      state: "each tone",
      drawn: (
        <Toasts
          toasts={toastTones.map((tone, id) => ({
            id,
            tone,
            line: `${tone} line`,
            detail: "More about it",
          }))}
          onDismiss={nothing}
        />
      ),
    },
  ],
  ToggleGroup: [
    {
      state: "one chosen",
      drawn: (
        <ToggleGroup
          label="View"
          options={["List", "Board"]}
          value="List"
          onChange={nothing}
        />
      ),
    },
  ],
  Tooltip: [
    {
      state: "shown on a control",
      drawn: (
        <Tooltip trigger="control" text="What pressing does">
          <button type="button">Press</button>
        </Tooltip>
      ),
      then: () => primitivesFocused("Press"),
    },
    {
      state: "on a disabled control",
      drawn: (
        <Tooltip trigger="abbreviation" text="Why it waits">
          <span>
            <button type="button" disabled>
              Send
            </button>
          </span>
        </Tooltip>
      ),
    },
  ],
  WordDetail: [
    {
      state: "a word with detail",
      drawn: (
        <p>
          <WordDetail word="Parked" detail="Waiting on a person" />
        </p>
      ),
    },
  ],
  copyHeld: [
    {
      state: "a copy button it holds",
      drawn: (
        <CopyProvider write={() => Promise.resolve(true)}>
          <CopyButton text="npm ci" label="Copy" />
        </CopyProvider>
      ),
    },
  ],
  ticketReferenceHeld: [
    {
      state: "a report's reference it holds",
      drawn: (
        <TicketReferenceProvider held={tickets}>
          <MarkdownReport text="closed [[ticket:15]]" bare />
        </TicketReferenceProvider>
      ),
    },
  ],
};

/** Every component module in the folder, by the name of its file. */
const primitiveModules = Object.keys(
  import.meta.glob("../app/browser/ui/*.tsx"),
).map((path) => path.slice(path.lastIndexOf("/") + 1, -".tsx".length));

test("every component module under ui/ has a case, and every case a module", () => {
  expect(primitiveModules.length).toBeGreaterThan(0);
  expect(Object.keys(primitiveCases).sort()).toEqual(
    [...primitiveModules].sort(),
  );
});

test("a control with no name is a finding, and an exception lets pass only its own rule", async () => {
  renderCopied(<button type="button" className="unnamed" />);
  expect(await primitivesFindings([])).toEqual(["button-name button"]);
  const reason = "the fixture carries it";
  expect(
    await primitivesFindings([
      { rule: "button-name", selector: ".unnamed", reason },
    ]),
  ).toEqual([]);
  expect(
    await primitivesFindings([
      { rule: "link-name", selector: ".unnamed", reason },
    ]),
  ).toEqual(["button-name button"]);
});

for (const [primitive, cases] of Object.entries(primitiveCases))
  test(`${primitive}, in each of its states, has no axe finding but for the layout, contrast and whole-page rules jsdom cannot judge`, async () => {
    for (const drawn of cases) {
      renderCopied(drawn.drawn);
      await drawn.then?.();
      expect(document.body.innerHTML, drawn.state).not.toBe("<div></div>");
      expect(await primitivesFindings(), drawn.state).toEqual([]);
      cleanup();
    }
  });
