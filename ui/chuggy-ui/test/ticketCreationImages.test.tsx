/**
 * Images attached in the creation form: each uploaded as the bytes picked,
 * pasted or dropped, drawn from a `data:` URI, carried by identity into the
 * release and through the YAML view, bounded where it is attached, and an
 * upload that fails leaving the form as it was. They are the author's, so
 * they stay attached under another configuration and are revised into a
 * draft a refused release left held.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { briefImagesMax } from "../../../src/contract/brief.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { CreationForm } from "../app/browser/TicketCreation.tsx";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { creationContextList } from "../app/core/ticketCreationRun.ts";
import { answeringApi } from "./answeringApi.ts";
import type { Sent } from "./answeringApi.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, holderDouble } from "./screenHarness.tsx";
import {
  creationDeclared,
  creationDraft,
  creationOffer,
  creationOffers,
  creationPartition,
} from "./ticketCreationFixture.ts";
import {
  ticketDraftRevised,
  ticketRefusingFirst,
  ticketReleasing,
} from "./ticketReleasing.tsx";

vi.mock(
  "../app/browser/editor/TicketEditor.tsx",
  () => import("./ticketReleasing.tsx"),
);

beforeEach(() => {
  resizeObserverStubbed();
  window.localStorage.clear();
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      answer({ content: "AQID", mediaType: "image/png", encoding: "base64" }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** An API minting `artifact-N` for each upload unless the case refuses one,
 * and creating and releasing a draft as the case says. */
function api(
  refusing = false,
  released = ticketReleasing,
): {
  readonly ports: ApiPorts;
  readonly sent: Sent[];
} {
  let minted = 0;
  return answeringApi((method, path) => {
    if (method === "POST" && path.endsWith("/artifacts")) {
      if (refusing)
        return { status: 413, body: { error: { code: "ArtifactTooLarge" } } };
      minted += 1;
      return {
        status: 201,
        body: { artifact: `artifact-${String(minted)}`, digest: "d" },
      };
    }
    return released(method, path);
  });
}

function draw(
  ports: ApiPorts,
  created: number[] = [],
  offers = creationOffers,
): void {
  render(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={new QueryClient()}>
        <CreationForm
          ports={ports}
          partition={creationPartition}
          queryKey={creationContextList(creationPartition).key}
          context={{
            context: "Ready",
            offers,
            partial: false,
            repositories: [],
          }}
          onCreated={(ticket) => created.push(ticket)}
        />
      </QueryClientProvider>
    </SessionProvider>,
  );
}

function shot(bytes: readonly number[], type = "image/png"): File {
  return new File([new Uint8Array(bytes)], "shot", { type });
}

function picked(...files: readonly File[]): void {
  fireEvent.change(screen.getByLabelText("Attach images"), {
    target: { files },
  });
}

function uploads(sent: readonly Sent[]): readonly Sent[] {
  return sent.filter(
    (one) => one.method === "POST" && one.path.endsWith("/artifacts"),
  );
}

async function thumbnails(count: number): Promise<readonly HTMLElement[]> {
  const list = await screen.findByRole("list", { name: "Images" });
  await waitFor(() => {
    expect(within(list).getAllByRole("img")).toHaveLength(count);
  });
  return within(list).getAllByRole("img");
}

test("a picked image is uploaded as its bytes and drawn from a data URI", async () => {
  const held = api();
  draw(held.ports);
  picked(shot([1, 2, 3]));
  const [image] = await thumbnails(1);
  expect(image?.getAttribute("src")).toBe("data:image/png;base64,AQID");
  const [upload] = uploads(held.sent);
  expect(upload?.body).toStrictEqual(new Uint8Array([1, 2, 3]));
});

test("a pasted image and a dropped one are each attached", async () => {
  draw(api().ports);
  const zone = screen.getByRole("group", { name: "Paste or drop images here" });
  fireEvent.paste(zone, {
    clipboardData: { files: [shot([1])], types: ["Files"] },
  });
  await thumbnails(1);
  fireEvent.drop(zone, {
    dataTransfer: { files: [shot([2])], types: ["Files"] },
  });
  await thumbnails(2);
});

test("a released ticket's brief names the images its uploads answered", async () => {
  const held = api();
  const created: number[] = [];
  draw(held.ports, created);
  fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
    target: { value: "ship it" },
  });
  picked(shot([1]), shot([2]));
  await thumbnails(2);
  const [first] = within(
    screen.getByRole("list", { name: "Images" }),
  ).getAllByRole("button", { name: "Remove" });
  if (first !== undefined) fireEvent.click(first);
  await thumbnails(1);
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  const draft = held.sent.find(
    (one) => one.method === "POST" && one.path.endsWith("/drafts"),
  );
  expect(draft?.body).toMatchObject({ brief: { images: ["artifact-2"] } });
});

test("an upload that fails attaches nothing and says why", async () => {
  draw(api(true).ports);
  picked(shot([1]));
  expect(
    await screen.findByText("· Not attached · Image too large", {
      exact: false,
    }),
  ).toBeDefined();
  expect(screen.queryByRole("list", { name: "Images" })).toBeNull();
  expect(screen.getByText(`0 / ${String(briefImagesMax)}`)).toBeDefined();
});

test("an attaching past the bound takes what fits and names the bound", async () => {
  const held = api();
  draw(held.ports);
  picked(...Array.from({ length: briefImagesMax + 1 }, (_, at) => shot([at])));
  await thumbnails(briefImagesMax);
  expect(uploads(held.sent)).toHaveLength(briefImagesMax);
  const bound = `one ticket carries at most ${String(briefImagesMax)} images`;
  expect(screen.getAllByText(bound, { exact: false }).length).toBeGreaterThan(
    0,
  );
  expect(screen.getByLabelText("Attach images").hasAttribute("disabled")).toBe(
    true,
  );
});

test("a file that is not an image the upload takes is not uploaded", async () => {
  const held = api();
  draw(held.ports);
  picked(shot([1], "image/svg+xml"));
  expect(
    await screen.findByText("only PNG, JPEG, GIF, WEBP images attach", {
      exact: false,
    }),
  ).toBeDefined();
  expect(uploads(held.sent)).toHaveLength(0);
});

async function toYaml(): Promise<HTMLTextAreaElement> {
  fireEvent.click(screen.getByRole("radio", { name: "YAML" }));
  return await screen.findByLabelText("Ticket YAML");
}

test("the YAML carries the attachments by identity, and back again", async () => {
  draw(api().ports);
  picked(shot([1]), shot([2]));
  await thumbnails(2);
  const text = await toYaml();
  expect(text.value).toContain("images:\n  - artifact-1\n  - artifact-2\n");
  fireEvent.click(screen.getByRole("radio", { name: "Form" }));
  await thumbnails(2);
});

test("deleting the key in the YAML removes the attachments", async () => {
  draw(api().ports);
  picked(shot([1]));
  await thumbnails(1);
  const text = await toYaml();
  fireEvent.change(text, {
    target: {
      value: text.value.replace("images:\n  - artifact-1\n", ""),
    },
  });
  fireEvent.click(screen.getByRole("radio", { name: "Form" }));
  await screen.findByLabelText("Attach images");
  expect(screen.queryByRole("list", { name: "Images" })).toBeNull();
});

test("an identity the screen never attached is a problem at that key", async () => {
  draw(api().ports);
  const text = await toYaml();
  fireEvent.change(text, {
    target: { value: "intent: y\nimages:\n  - artifact-9\n" },
  });
  const problems = await screen.findByRole("list", { name: "Problems" });
  expect(problems.textContent).toContain(
    "line 3: `artifact-9` names no image attached to this ticket",
  );
});

function typeIntent(text: string): void {
  fireEvent.change(screen.getByPlaceholderText("what this ticket is for"), {
    target: { value: text },
  });
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
}

function revisions(sent: readonly Sent[]): readonly unknown[] {
  return sent.filter((one) => one.method === "PUT").map((one) => one.body);
}

const heldNote = /was created and not released/u;

/**
 * The draft a refused release leaves held was written from the form as it
 * was, so an image attached or removed since is a form that says something
 * else, and the next submit revises the draft to it.
 */
test("an image attached after a refused release is revised into the held draft", async () => {
  const held = api(
    false,
    ticketRefusingFirst(() => ticketDraftRevised()),
  );
  const created: number[] = [];
  draw(held.ports, created);
  typeIntent("ship it");
  submit();
  await screen.findByText(heldNote);
  picked(shot([1]));
  await thumbnails(1);
  submit();
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  expect(revisions(held.sent)).toMatchObject([
    {
      expectedVersion: creationDraft.authoringVersion,
      brief: { intent: "ship it", images: ["artifact-1"] },
    },
  ]);
});

test("an image removed after a refused release is revised out of the held draft", async () => {
  const held = api(
    false,
    ticketRefusingFirst(() => ticketDraftRevised()),
  );
  const created: number[] = [];
  draw(held.ports, created);
  typeIntent("ship it");
  picked(shot([1]));
  await thumbnails(1);
  submit();
  await screen.findByText(heldNote);
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  submit();
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  const [revised] = revisions(held.sent);
  expect(revised).toMatchObject({ brief: { intent: "ship it" } });
  expect(revised).not.toHaveProperty("brief.images");
});

const chuggy = "https://forge.test/kasofsk/chuggy";
const several = [
  creationOffer(creationDeclared("n-development", chuggy, "development")),
  creationOffer(creationDeclared("n-sonnet", chuggy, "development-sonnet")),
];

async function chooseConfiguration(name: string): Promise<void> {
  const picker = () => screen.getByRole("button", { name: /^Configuration/u });
  await waitFor(() => {
    expect(screen.queryByRole("menu")).toBeNull();
  });
  fireEvent.keyDown(picker(), { key: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  fireEvent.click(within(menu).getByRole("menuitemradio", { name }));
  await waitFor(() => {
    expect(picker().textContent).toContain(name);
  });
}

test("images attached under one configuration stay attached under the one chosen next", async () => {
  const held = api();
  const created: number[] = [];
  draw(held.ports, created, several);
  typeIntent("ship it");
  await chooseConfiguration("development");
  picked(shot([1]));
  await thumbnails(1);
  await chooseConfiguration("development-sonnet");
  await thumbnails(1);
  submit();
  await waitFor(() => {
    expect(created).toStrictEqual([creationDraft.ticket]);
  });
  expect(
    held.sent.find((one) => one.path.endsWith("/drafts"))?.body,
  ).toMatchObject({
    configurationRevision: "n-sonnet",
    brief: { images: ["artifact-1"] },
  });
});
