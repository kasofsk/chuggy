/**
 * The Connectors page, mounted over a double that keeps the project's
 * connectors and their history as the API does: the empty line and the list,
 * one connector of each kind added with its optional settings left out and
 * filled in, a change made against the revision read, a removal only once it
 * is confirmed, the history a page at a time, an AWS connector's session tags
 * either way, a reader who may not administer offered no write, and each
 * refusal from the body the API answers it with.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  connectorLimitReachedCode,
  connectorNotFoundCode,
  connectorStaleCode,
} from "../../../../src/contract/connectorAdministration.ts";
import type {
  ConnectorChangeResponse,
  ConnectorHistoryResponse,
  ConnectorStandingResponse,
  ConnectorWriteRequest,
} from "../../../../src/contract/connectorAdministration.ts";
import type { ProjectAbilitiesResponse } from "../../../../src/contract/responses.ts";
import { ConnectorsPage } from "../../app/browser/connectors/ConnectorsPage.tsx";
import { CopyProvider } from "../../app/browser/ui/copyHeld.tsx";
import type { CopyWrite } from "../../app/browser/ui/copyHeld.tsx";
import { abilitiesEvery, abilitiesNone } from "../projectAbilitiesFixture.ts";
import { projectPartition } from "../projectFixture.ts";
import { resizeObserverStubbed } from "../resizeObserver.ts";
import {
  answer,
  drawnStrict,
  press,
  sectionOf,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  connectorInvalidNameBody,
  connectorInvalidSettingsBody,
} from "./connectorRefusalFixture.ts";

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  nowMs: () => Date.parse("2026-11-19T12:00:00Z"),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...projectPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const author = { kind: "user", subject: abilitiesEvery.principal };

const deploy: ConnectorStandingResponse = {
  name: "deploy",
  revision: 3,
  kind: "Aws",
  settings: { roleArn: "arn:aws:iam::123456789012:role/deploy" },
};

const build: ConnectorStandingResponse = {
  name: "build",
  revision: 1,
  kind: "Gcp",
  settings: { projectNumber: "1234", pool: "ci", provider: "chuggy" },
};

/** What a write or removal answers in place of landing, by its status. */
interface ConnectorsRefusing {
  readonly status: number;
  readonly body: unknown;
}

interface ConnectorsServed {
  readonly abilities?: ProjectAbilitiesResponse;
  readonly connectors?: readonly ConnectorStandingResponse[];
  /** Each history page, by the cursor it answers; the newest under none. */
  readonly history?: ReadonlyMap<number | undefined, ConnectorHistoryResponse>;
  /** The next write's refusal, once; each write after it lands. */
  readonly writeRefused?: ConnectorsRefusing;
  /** What the list reads as once a refused write has been answered. */
  readonly afterRefusal?: readonly ConnectorStandingResponse[];
  readonly removalRefused?: ConnectorsRefusing;
  readonly copied?: CopyWrite;
}

interface ConnectorsDrawn {
  readonly drawn: DrawnStrict;
  readonly writes: () => readonly SentRequest[];
  readonly removals: () => readonly SentRequest[];
  readonly listReads: () => number;
}

const connectorsAt = /\/connectors(?:\/([^/?]+))?(?:\?(.*))?$/u;

/** The API's connectors over `served`, keeping what each write that lands makes. */
function connectorsServer(
  served: ConnectorsServed,
): (request: SentRequest) => Response {
  let standing = [...(served.connectors ?? [])];
  let writeRefused = served.writeRefused;
  let removalRefused = served.removalRefused;
  return (request) => {
    if (request.url.endsWith("/abilities"))
      return answer(served.abilities ?? abilitiesEvery);
    const at = connectorsAt.exec(request.url);
    if (at === null) return answer({}, 404);
    const [, name, query] = at;
    if (name === undefined) return answer({ connectors: standing });
    if (name === "history") {
      const before = new URLSearchParams(query).get("before");
      return answer(
        served.history?.get(before === null ? undefined : Number(before)) ?? {
          changes: [],
        },
      );
    }
    if (request.method === "PUT") {
      if (writeRefused !== undefined) {
        const refused = writeRefused;
        writeRefused = undefined;
        standing = [...(served.afterRefusal ?? standing)];
        return answer(refused.body, refused.status);
      }
      const written = request.body as ConnectorWriteRequest;
      const before = standing.find((connector) => connector.name === name);
      const made = {
        name,
        kind: written.kind,
        settings: written.settings,
        revision: (before?.revision ?? 0) + 1,
      } as ConnectorStandingResponse;
      standing = [
        ...standing.filter((connector) => connector.name !== name),
        made,
      ];
      return answer(made, before === undefined ? 201 : 200);
    }
    if (removalRefused !== undefined) {
      const refused = removalRefused;
      removalRefused = undefined;
      return answer(refused.body, refused.status);
    }
    standing = standing.filter((connector) => connector.name !== name);
    return new Response(null, { status: 204 });
  };
}

async function drawConnectors(
  served: ConnectorsServed = {},
): Promise<ConnectorsDrawn> {
  const page = (
    <CopyProvider write={served.copied ?? (() => Promise.resolve(true))}>
      <ConnectorsPage />
    </CopyProvider>
  );
  const drawn = await drawnStrict(page, connectorsServer(served));
  const connectorRequests = (method: string) =>
    drawn.sent.filter(
      (sent) =>
        sent.method === method &&
        connectorsAt.test(sent.url.split("?")[0] ?? ""),
    );
  return {
    drawn,
    writes: () => connectorRequests("PUT"),
    removals: () => connectorRequests("DELETE"),
    listReads: () =>
      drawn.sent.filter(
        (sent) => sent.method === "GET" && sent.url.endsWith("/connectors"),
      ).length,
  };
}

function connectorsSection(): HTMLElement {
  return sectionOf("Connectors");
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function cardOf(name: string): HTMLElement {
  const heading = within(connectorsSection()).getByRole("heading", {
    name,
    level: 3,
  });
  const card = heading.closest("li");
  if (card === null) throw new Error(`no card holds ${name}`);
  return card;
}

/** What a card says of its settings, label then value. */
function settingsOf(name: string): readonly (readonly [string, string])[] {
  return within(cardOf(name))
    .getAllByRole("term")
    .map((term) => [
      term.textContent,
      term.nextElementSibling?.textContent ?? "",
    ]);
}

async function typed(label: string | RegExp, value: string): Promise<void> {
  await turned(() => {
    fireEvent.change(within(dialog()).getByRole("textbox", { name: label }), {
      target: { value },
    });
  });
}

async function chosen(kind: string): Promise<void> {
  await turned(() => {
    fireEvent.click(within(dialog()).getByRole("radio", { name: kind }));
  });
}

/** The text fields the open dialog draws, by their labels. */
function fieldLabels(): readonly string[] {
  return within(dialog())
    .getAllByRole("textbox")
    .map((field) => field.getAttribute("aria-label") ?? labelOf(field));
}

function labelOf(field: HTMLElement): string {
  const labelled = document.querySelector(`label[for="${field.id}"]`);
  return labelled?.textContent ?? "";
}

/** The line drawn beside a field, read as what the field is described by. */
function faultBeside(label: string | RegExp): string {
  const field = within(dialog()).getByRole("textbox", { name: label });
  return field.getAttribute("aria-description") ?? describedText(field);
}

function describedText(field: HTMLElement): string {
  return (field.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

test("an empty project says what a connector is for, and its history that nothing has changed", async () => {
  await drawConnectors();
  const section = connectorsSection();
  expect(within(section).getByText("No connectors")).toBeTruthy();
  expect(
    within(section).getByText(
      "A connector lets this project's runs be issued a cloud identity, such as an AWS role, with no secret stored. A workload asks for one by its credential name.",
    ),
  ).toBeTruthy();
  expect(within(sectionOf("History")).getByText("No changes yet")).toBeTruthy();
});

test("the list draws each connector's name, kind and settings, and its credential name ready to copy", async () => {
  const copied = vi.fn<CopyWrite>(() => Promise.resolve(true));
  await drawConnectors({ connectors: [build, deploy], copied });
  expect(
    within(screen.getByRole("list", { name: "The project's connectors" }))
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toStrictEqual(["build", "deploy"]);
  expect(within(cardOf("build")).getByText("Google Cloud")).toBeTruthy();
  expect(settingsOf("build")).toStrictEqual([
    ["Project number", "1234"],
    ["Identity pool", "ci"],
    ["Identity pool provider", "chuggy"],
    ["Service account email", "Not set"],
  ]);
  expect(within(cardOf("deploy")).getByText("AWS")).toBeTruthy();
  expect(settingsOf("deploy")).toStrictEqual([
    ["Role ARN", deploy.settings.roleArn],
    ["Session tags", "Off"],
  ]);
  expect(
    within(cardOf("deploy")).getByText("chuggy.connector.deploy"),
  ).toBeTruthy();
  await turned(() => {
    fireEvent.click(
      within(cardOf("deploy")).getByRole("button", {
        name: "Copy chuggy.connector.deploy",
      }),
    );
  });
  expect(copied).toHaveBeenCalledWith("chuggy.connector.deploy");
});

/** One connector of each kind, as typed and as the write must carry it. */
const connectorsEachKind: readonly {
  readonly kind: string;
  readonly fields: readonly string[];
  readonly typed: Readonly<Record<string, string>>;
  readonly sent: ConnectorWriteRequest;
}[] = [
  {
    kind: "AWS",
    fields: ["Role ARN"],
    typed: { "Role ARN": " arn:aws:iam::1:role/r " },
    sent: { kind: "Aws", settings: { roleArn: "arn:aws:iam::1:role/r" } },
  },
  {
    kind: "Google Cloud",
    fields: [
      "Project number",
      "Identity pool",
      "Identity pool provider",
      "Service account email (optional)",
    ],
    typed: {
      "Project number": "42",
      "Identity pool": "ci",
      "Identity pool provider": "chuggy",
    },
    sent: {
      kind: "Gcp",
      settings: { projectNumber: "42", pool: "ci", provider: "chuggy" },
    },
  },
  {
    kind: "Google Cloud",
    fields: [],
    typed: {
      "Project number": "42",
      "Identity pool": "ci",
      "Identity pool provider": "chuggy",
      "Service account email (optional)": "ci@example.test",
    },
    sent: {
      kind: "Gcp",
      settings: {
        projectNumber: "42",
        pool: "ci",
        provider: "chuggy",
        serviceAccount: "ci@example.test",
      },
    },
  },
  {
    kind: "Azure",
    fields: ["Tenant ID", "Client ID"],
    typed: { "Tenant ID": "t-1", "Client ID": "c-1" },
    sent: { kind: "Azure", settings: { tenantId: "t-1", clientId: "c-1" } },
  },
  {
    kind: "Anthropic",
    fields: [
      "Organization ID",
      "Federation rule ID",
      "Service account ID (optional)",
      "Workspace ID (optional)",
    ],
    typed: { "Organization ID": "o-1", "Federation rule ID": "f-1" },
    sent: {
      kind: "Anthropic",
      settings: { organizationId: "o-1", federationRuleId: "f-1" },
    },
  },
  {
    kind: "Anthropic",
    fields: [],
    typed: {
      "Organization ID": "o-1",
      "Federation rule ID": "f-1",
      "Service account ID (optional)": "s-1",
      "Workspace ID (optional)": "w-1",
    },
    sent: {
      kind: "Anthropic",
      settings: {
        organizationId: "o-1",
        federationRuleId: "f-1",
        serviceAccountId: "s-1",
        workspaceId: "w-1",
      },
    },
  },
];

test("each kind is added with exactly its own fields, its optional settings left out or filled in", async () => {
  const served = await drawConnectors();
  for (const [at, each] of connectorsEachKind.entries()) {
    const name = `made-${String(at)}`;
    await press("Add connector");
    await typed("Name", name);
    await chosen(each.kind);
    if (each.fields.length > 0)
      expect(fieldLabels()).toStrictEqual(["Name", ...each.fields]);
    for (const [label, value] of Object.entries(each.typed))
      await typed(label, value);
    await turned(() => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Add connector" }),
      );
    });
    await settled();
    expect(screen.queryByRole("dialog")).toBeNull();
    const sent = served.writes().at(-1);
    expect(sent?.url.endsWith(`/connectors/${name}`)).toBe(true);
    expect(sent?.body).toStrictEqual(each.sent);
    expect(cardOf(name)).toBeTruthy();
  }
});

test("Add is not sent until the required settings are typed, and a typed value the contract refuses says so beside it", async () => {
  await drawConnectors();
  await press("Add connector");
  const add = within(dialog()).getByRole<HTMLButtonElement>("button", {
    name: "Add connector",
  });
  await typed("Name", "deploy");
  expect(add.disabled).toBe(true);
  await typed("Role ARN", "role/deploy");
  expect(add.disabled).toBe(true);
  expect(faultBeside("Role ARN")).toContain(
    "An IAM role ARN, starting arn: with no spaces or braces.",
  );
  await typed("Name", "Deploy!");
  expect(faultBeside("Name")).toContain(
    "Lower-case letters, digits and hyphens, starting and ending with a letter or digit, at most 40 characters.",
  );
});

test("a change is written against the revision read, with its name and kind not offered to change", async () => {
  const served = await drawConnectors({ connectors: [deploy] });
  await press("Change deploy");
  expect(within(dialog()).queryByRole("textbox", { name: "Name" })).toBeNull();
  expect(within(dialog()).queryByRole("radio")).toBeNull();
  expect(within(dialog()).getByText("deploy")).toBeTruthy();
  expect(
    within(dialog()).getByRole<HTMLInputElement>("textbox", {
      name: "Role ARN",
    }).value,
  ).toBe(deploy.settings.roleArn);
  await typed("Role ARN", "arn:aws:iam::123456789012:role/other");
  await press("Save");
  expect(served.writes().map((sent) => sent.body)).toStrictEqual([
    {
      kind: "Aws",
      settings: { roleArn: "arn:aws:iam::123456789012:role/other" },
      expectedRevision: 3,
    },
  ]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(settingsOf("deploy")[0]).toStrictEqual([
    "Role ARN",
    "arn:aws:iam::123456789012:role/other",
  ]);
});

test("Remove asks first, naming what fails, and sends nothing until it is confirmed", async () => {
  const served = await drawConnectors({ connectors: [deploy] });
  await press("Remove deploy");
  const card = cardOf("deploy");
  expect(
    within(card).getByRole("group", { name: "Remove deploy?" }),
  ).toBeTruthy();
  expect(
    within(card).getByText(
      "Runs whose configuration lists chuggy.connector.deploy will fail until a connector named deploy is added again.",
    ),
  ).toBeTruthy();
  await press("Cancel");
  expect(
    within(cardOf("deploy")).queryByRole("group", { name: "Remove deploy?" }),
  ).toBeNull();
  expect(served.removals()).toStrictEqual([]);
  await press("Remove deploy");
  await turned(() => {
    fireEvent.click(
      within(cardOf("deploy")).getByRole("button", { name: "Remove" }),
    );
  });
  await settled();
  expect(served.removals().map((sent) => sent.url)).toStrictEqual([
    expect.stringMatching(/\/connectors\/deploy\?expectedRevision=3$/u),
  ]);
  expect(within(connectorsSection()).getByText("No connectors")).toBeTruthy();
});

function change(
  revision: number,
  action: "Created" | "Changed" | "Removed",
  name: string,
): ConnectorChangeResponse {
  const recorded = {
    change: revision,
    changedAt: "2026-11-18T12:00:00Z",
    author,
    name,
  };
  return action === "Removed"
    ? { ...recorded, action }
    : {
        ...recorded,
        action,
        kind: "Aws",
        settings: { roleArn: "arn:aws:iam::123456789012:role/deploy" },
      };
}

function historyRows(): readonly string[] {
  return within(sectionOf("History"))
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent);
}

test("the history reads newest first, and its next page only when asked for", async () => {
  const served = await drawConnectors({
    history: new Map([
      [
        undefined,
        {
          changes: [
            change(7, "Removed", "old"),
            change(6, "Changed", "deploy"),
          ],
          next: 6,
        },
      ],
      [6, { changes: [change(5, "Created", "deploy")] }],
    ]),
  });
  expect(historyRows()).toStrictEqual(["Removed old", "Changed deploy"]);
  const olderReads = () =>
    served.drawn.sent.filter((sent) => sent.url.includes("?before=")).length;
  expect(olderReads()).toBe(0);
  await press("Show older changes");
  expect(
    served.drawn.sent.some((sent) =>
      sent.url.endsWith("/connectors/history?before=6"),
    ),
  ).toBe(true);
  expect(historyRows()).toStrictEqual([
    "Removed old",
    "Changed deploy",
    "Added deploy",
  ]);
  expect(
    screen.queryByRole("button", { name: "Show older changes" }),
  ).toBeNull();
});

test("an AWS connector's session tags are a switch, off unless turned on, with the trust policy's cost beside it", async () => {
  const served = await drawConnectors();
  for (const [name, on] of [
    ["untagged", false],
    ["tagged", true],
  ] as const) {
    await press("Add connector");
    await typed("Name", name);
    const tags = within(dialog()).getByRole("switch", { name: "Session tags" });
    expect(tags.getAttribute("aria-checked")).toBe("false");
    expect(describedText(tags)).toContain(
      "Every role this connector assumes must allow sts:TagSession in its trust policy, or AWS refuses the run.",
    );
    if (on)
      await turned(() => {
        fireEvent.click(tags);
      });
    await typed("Role ARN", "arn:aws:iam::1:role/r");
    await turned(() => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Add connector" }),
      );
    });
    await settled();
    expect(served.writes().at(-1)?.body).toStrictEqual({
      kind: "Aws",
      settings: {
        roleArn: "arn:aws:iam::1:role/r",
        ...(on ? { sessionTags: true } : {}),
      },
    });
    expect(settingsOf(name).at(-1)).toStrictEqual([
      "Session tags",
      on ? "On" : "Off",
    ]);
  }
});

test("a reader who may not administer is offered no add, change or remove", async () => {
  await drawConnectors({ abilities: abilitiesNone, connectors: [deploy] });
  expect(cardOf("deploy")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add connector" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Change deploy" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove deploy" })).toBeNull();
  expect(
    within(cardOf("deploy")).getByRole("button", {
      name: "Copy chuggy.connector.deploy",
    }),
  ).toBeTruthy();
});

const staleBody = (standing: number) => ({
  error: {
    code: connectorStaleCode,
    message:
      "The connector's revision is not the one this request was made against.",
  },
  standing,
});

test("a change the connector moved under reads the list again, says so, and keeps what was typed for a Save at the new revision", async () => {
  const moved = { ...deploy, revision: 4 };
  const served = await drawConnectors({
    connectors: [deploy],
    writeRefused: { status: 409, body: staleBody(4) },
    afterRefusal: [moved],
  });
  await press("Change deploy");
  await typed("Role ARN", "arn:aws:iam::1:role/mine");
  const readsBefore = served.listReads();
  await press("Save");
  expect(served.listReads()).toBeGreaterThan(readsBefore);
  expect(
    within(dialog()).getByText(
      "This connector changed since this page read it. The list has been read again, and what you typed is kept.",
    ),
  ).toBeTruthy();
  expect(
    within(dialog()).getByRole<HTMLInputElement>("textbox", {
      name: "Role ARN",
    }).value,
  ).toBe("arn:aws:iam::1:role/mine");
  await press("Save");
  expect(served.writes().map((sent) => sent.body)).toStrictEqual([
    {
      kind: "Aws",
      settings: { roleArn: "arn:aws:iam::1:role/mine" },
      expectedRevision: 3,
    },
    {
      kind: "Aws",
      settings: { roleArn: "arn:aws:iam::1:role/mine" },
      expectedRevision: 4,
    },
  ]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

/** A new AWS connector typed in full and sent. */
async function addedAws(name: string): Promise<void> {
  await press("Add connector");
  await typed("Name", name);
  await typed("Role ARN", "arn:aws:iam::1:role/r");
  await turned(() => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Add connector" }),
    );
  });
  await settled();
}

test("the connector limit, a refused name and a refused setting are each said beside the field concerned", async () => {
  const refusals: readonly (readonly [ConnectorsRefusing, string, string])[] = [
    [
      {
        status: 409,
        body: {
          error: {
            code: connectorLimitReachedCode,
            message: "The project holds as many connectors as it may.",
          },
        },
      },
      "Name",
      "This project already holds 32 connectors, as many as it may. Remove one to add another.",
    ],
    [
      { status: 400, body: connectorInvalidNameBody("-deploy") },
      "Name",
      "Lower-case letters, digits and hyphens, starting and ending with a letter or digit, at most 40 characters.",
    ],
    [
      {
        status: 400,
        body: connectorInvalidSettingsBody({
          kind: "Aws",
          settings: { roleArn: "role/deploy" },
        }),
      },
      "Role ARN",
      "An IAM role ARN, starting arn: with no spaces or braces.",
    ],
  ];
  for (const [refused, label, line] of refusals) {
    await drawConnectors({ writeRefused: refused });
    await addedAws("deploy");
    expect(faultBeside(label)).toContain(line);
    expect(
      within(dialog()).getByText("Some fields above need another look."),
    ).toBeTruthy();
    expect(
      within(dialog()).getByRole<HTMLInputElement>("textbox", { name: "Name" })
        .value,
    ).toBe("deploy");
    cleanup();
  }
});

test("a removal the connector moved under says so on its card over the list read again, and one already gone says nothing", async () => {
  const served = await drawConnectors({
    connectors: [deploy],
    removalRefused: { status: 409, body: staleBody(4) },
  });
  await press("Remove deploy");
  await turned(() => {
    fireEvent.click(
      within(cardOf("deploy")).getByRole("button", { name: "Remove" }),
    );
  });
  await settled();
  expect(
    within(cardOf("deploy")).getByText(
      "This connector changed since this page read it. The list has been read again, and what you typed is kept.",
    ),
  ).toBeTruthy();
  expect(served.removals()).toHaveLength(1);
  cleanup();
  await drawConnectors({
    connectors: [deploy],
    removalRefused: {
      status: 404,
      body: {
        error: {
          code: connectorNotFoundCode,
          message: "The project holds no connector of that name.",
        },
      },
    },
  });
  await press("Remove deploy");
  await turned(() => {
    fireEvent.click(
      within(cardOf("deploy")).getByRole("button", { name: "Remove" }),
    );
  });
  await settled();
  expect(
    within(connectorsSection())
      .queryAllByRole("status")
      .map((status) => status.textContent)
      .filter((said) => said !== ""),
  ).toStrictEqual([]);
});

test("every control is named, and the kind is chosen from the keyboard", async () => {
  await drawConnectors({ connectors: [deploy] });
  for (const name of ["Add connector", "Change deploy", "Remove deploy"])
    expect(screen.getByRole("button", { name })).toBeTruthy();
  await press("Add connector");
  const opened = screen.getByRole("dialog", { name: "Add connector" });
  expect(within(opened).getByRole("radiogroup", { name: "Kind" })).toBeTruthy();
  const aws = within(opened).getByRole("radio", { name: "AWS" });
  expect(aws.getAttribute("aria-checked")).toBe("true");
  await turned(() => {
    aws.focus();
    fireEvent.keyDown(aws, { key: "ArrowDown" });
  });
  expect(
    within(opened)
      .getByRole("radio", { name: "Google Cloud" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(fieldLabels()).toContain("Project number");
  expect(within(opened).queryByRole("switch")).toBeNull();
});
