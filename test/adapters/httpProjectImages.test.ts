/**
 * A project's icon and banner as their routes answer them, over the service
 * the API composes: read by a reader, named and cleared by an administrator
 * alone, each refusal answered with its own code, and every body refused that
 * carries a field its schema does not name.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { artifactUnavailableCode } from "../../src/contract/rosters.ts";
import {
  nativeHttpRoutes,
  projectIconBytesMax,
} from "../../src/contract/http.ts";
import { projectImagesResponseSchema } from "../../src/contract/responses.ts";
import {
  administrator,
  atlas,
  borealis,
  developer,
  projectImagesArtifact,
  projectImagesFixture,
  projectImagesStored,
  reader,
  stranger,
} from "../interpreter/projectImagesFixture.ts";
import {
  callerApp,
  callerAppCodeOf,
  callerAppSent,
} from "./callerAppFixture.ts";

const bearer = { authorization: "Bearer valid" };

const atlasPath = (route: string, role = "") =>
  route
    .replace(":tenant", "acme")
    .replace(":project", "atlas")
    .replace(":role", role);
const imagesPath = atlasPath(nativeHttpRoutes.projectImages);
const iconPath = atlasPath(nativeHttpRoutes.projectImage, "icon");
const bannerPath = atlasPath(nativeHttpRoutes.projectImage, "banner");

const icon = projectImagesArtifact("image/png", "mark");
const banner = projectImagesArtifact("image/webp", "wide");

/** A fixture whose project holds `icon` and `banner`, each within its role's bound. */
function projectImagesHttpFixture() {
  const fixture = projectImagesFixture();
  projectImagesStored(fixture.held, atlas, icon, 16);
  projectImagesStored(fixture.held, atlas, banner, 16);
  return fixture;
}

test("an administrator names an icon and a banner and clears the icon, each answer the images as they now stand", async () => {
  const { held, service } = projectImagesHttpFixture();
  await using app = callerApp(administrator, { projectImages: service });
  const named = await callerAppSent(app, "PUT", iconPath, { artifact: icon });
  assert.equal(named.statusCode, 200);
  assert.deepEqual(projectImagesResponseSchema.parse(named.json()), {
    icon,
    administers: true,
  });
  assert.deepEqual(
    (await callerAppSent(app, "PUT", bannerPath, { artifact: banner })).json(),
    { icon, banner, administers: true },
  );
  const cleared = await callerAppSent(app, "DELETE", iconPath);
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(cleared.json(), { banner, administers: true });
  const read = await app.inject({ url: imagesPath, headers: bearer });
  assert.deepEqual(read.json(), { banner, administers: true });
  assert.deepEqual(held.images, { banner });
});

test("a developer and a reader read the images and are refused naming or clearing either", async () => {
  for (const caller of [developer, reader]) {
    const { held, service } = projectImagesHttpFixture();
    held.images = { icon };
    await using app = callerApp(caller, { projectImages: service });
    const read = await app.inject({ url: imagesPath, headers: bearer });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json(), { icon, administers: false });
    assert.equal(
      (await callerAppSent(app, "PUT", bannerPath, { artifact: banner }))
        .statusCode,
      404,
    );
    assert.equal(
      (await callerAppSent(app, "DELETE", iconPath)).statusCode,
      404,
    );
    assert.deepEqual(held.writes, []);
  }
});

test("a caller who may not read the project is told none of its image routes is there", async () => {
  const { held, service } = projectImagesHttpFixture();
  await using app = callerApp(stranger, { projectImages: service });
  assert.equal(
    (await app.inject({ url: imagesPath, headers: bearer })).statusCode,
    404,
  );
  assert.equal(
    (await callerAppSent(app, "PUT", iconPath, { artifact: icon })).statusCode,
    404,
  );
  assert.deepEqual(held.writes, []);
});

test("each refusal of a naming is answered 422 with its own code, and writes nothing", async () => {
  const { held, service } = projectImagesHttpFixture();
  const theirs = projectImagesArtifact("image/png", "theirs");
  projectImagesStored(held, borealis, theirs, 16);
  const gif = projectImagesArtifact("image/gif", "moving");
  projectImagesStored(held, atlas, gif, 16);
  const large = projectImagesArtifact("image/jpeg", "large");
  projectImagesStored(held, atlas, large, projectIconBytesMax + 1);
  await using app = callerApp(administrator, { projectImages: service });
  for (const [artifact, code] of [
    [theirs, "ImageNotFound"],
    [gif, "ImageTypeNotAdmitted"],
    [large, "ImageTooLarge"],
  ] as const) {
    const refused = await callerAppSent(app, "PUT", iconPath, { artifact });
    assert.equal(refused.statusCode, 422, code);
    assert.equal(callerAppCodeOf(refused), code);
  }
  assert.equal(
    (await callerAppSent(app, "PUT", iconPath, { artifact: large })).json<{
      bytesMax: number;
    }>().bytesMax,
    projectIconBytesMax,
  );
  held.unavailable = true;
  const unavailable = await callerAppSent(app, "PUT", iconPath, {
    artifact: icon,
  });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(callerAppCodeOf(unavailable), artifactUnavailableCode);
  assert.deepEqual(held.writes, []);
});

test("a role the route does not know is not there, and a body naming a field its schema does not is refused", async () => {
  const { held, service } = projectImagesHttpFixture();
  await using app = callerApp(administrator, { projectImages: service });
  const unknown = atlasPath(nativeHttpRoutes.projectImage, "favicon");
  assert.equal(
    (await callerAppSent(app, "PUT", unknown, { artifact: icon })).statusCode,
    404,
  );
  assert.equal((await callerAppSent(app, "DELETE", unknown)).statusCode, 404);
  for (const body of [{ artifact: icon, extra: true }, {}, { artifact: "" }]) {
    const answer = await callerAppSent(app, "PUT", iconPath, body);
    assert.equal(answer.statusCode, 400, JSON.stringify(body));
    assert.equal(callerAppCodeOf(answer), "InvalidRequest");
  }
  assert.deepEqual(held.writes, []);
});

test("the images response refuses a field it does not name", () => {
  assert.equal(
    projectImagesResponseSchema.safeParse({ administers: true, extra: 1 })
      .success,
    false,
  );
});
