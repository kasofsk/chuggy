/**
 * A project's icon and banner as the service decides them: a developer may
 * upload an image and may not name it, an administrator names and clears
 * either role, and naming is refused for an artifact the project does not
 * hold, a type neither role admits, and bytes past the role's bound.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectBannerBytesMax,
  projectIconBytesMax,
  projectImageMediaTypes,
} from "../../src/contract/http.ts";
import { authorizedProjectMutation } from "../../src/interpreter/authorizedProject.ts";
import { asProjectArtifactId } from "../../src/interpreter/finalizerPreparation.ts";
import { projectArtifactUploaded } from "../../src/interpreter/projectArtifact.ts";
import { projectImageTypeAdmitted } from "../../src/interpreter/projectImages.ts";
import {
  administrator,
  atlas,
  borealis,
  developer,
  projectImagesArtifact,
  projectImagesFixture,
  projectImagesStored,
  projectImagesAccess,
  reader,
  stranger,
} from "./projectImagesFixture.ts";

test("a developer uploads an image the way any artifact is uploaded, and is refused naming it", async () => {
  const { held, artifacts, service } = projectImagesFixture();
  const uploaded = await authorizedProjectMutation(
    projectImagesAccess,
    developer,
    atlas,
    () =>
      projectArtifactUploaded(
        { mint: (mediaType) => projectImagesArtifact(mediaType, "mark") },
        artifacts,
        atlas,
        "image/png",
        new Uint8Array(16),
      ),
  );
  assert.equal(uploaded.result, "Authorized");
  const icon = projectImagesArtifact("image/png", "mark");
  assert.deepEqual(await service.name(developer, atlas, "icon", icon), {
    result: "NotFound",
  });
  assert.deepEqual(await service.name(developer, atlas, "icon", undefined), {
    result: "NotFound",
  });
  assert.deepEqual(held.writes, []);
});

test("an administrator names an icon and a banner, reads both, and clears each alone", async () => {
  const { held, service } = projectImagesFixture();
  const icon = projectImagesArtifact("image/png", "mark");
  const banner = projectImagesArtifact("image/jpeg", "wide");
  projectImagesStored(held, atlas, icon, projectIconBytesMax);
  projectImagesStored(held, atlas, banner, projectBannerBytesMax);
  assert.deepEqual(await service.name(administrator, atlas, "icon", icon), {
    result: "Written",
    view: { images: { icon }, administers: true },
  });
  assert.deepEqual(await service.name(administrator, atlas, "banner", banner), {
    result: "Written",
    view: { images: { icon, banner }, administers: true },
  });
  assert.equal(
    (await service.name(administrator, atlas, "banner", banner)).result,
    "Unchanged",
  );
  assert.deepEqual(await service.images(reader, atlas), {
    result: "Found",
    view: { images: { icon, banner }, administers: false },
  });
  assert.deepEqual(
    await service.name(administrator, atlas, "icon", undefined),
    {
      result: "Written",
      view: { images: { banner }, administers: true },
    },
  );
  assert.deepEqual(held.writes, [
    `icon:administrator:${icon}`,
    `banner:administrator:${banner}`,
    `banner:administrator:${banner}`,
    "icon:administrator:",
  ]);
});

test("an artifact another project holds is refused ImageNotFound, as one nobody holds is", async () => {
  const { held, service } = projectImagesFixture();
  const theirs = projectImagesArtifact("image/png", "theirs");
  projectImagesStored(held, borealis, theirs, 16);
  for (const artifact of [theirs, projectImagesArtifact("image/png", "none")])
    assert.deepEqual(
      await service.name(administrator, atlas, "icon", artifact),
      { result: "ImageNotFound" },
    );
  assert.deepEqual(held.writes, []);
});

test("an artifact whose type neither role admits is refused before the store is read", async () => {
  const { held, service } = projectImagesFixture();
  const gif = projectImagesArtifact("image/gif", "moving");
  projectImagesStored(held, atlas, gif, 16);
  held.unavailable = true;
  for (const artifact of [
    gif,
    asProjectArtifactId("image/svg+xml:drawn"),
    asProjectArtifactId("opaque"),
  ])
    for (const role of ["icon", "banner"] as const)
      assert.deepEqual(
        await service.name(administrator, atlas, role, artifact),
        {
          result: "ImageTypeNotAdmitted",
        },
      );
  assert.deepEqual(held.writes, []);
});

test("the roles admit PNG, JPEG and WebP, and never SVG", () => {
  assert.deepEqual(projectImageMediaTypes, [
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  for (const mediaType of projectImageMediaTypes)
    assert.ok(projectImageTypeAdmitted(projectImagesArtifact(mediaType, "t")));
  assert.equal(
    projectImageTypeAdmitted(asProjectArtifactId("image/svg+xml:t")),
    false,
  );
});

test("an artifact one byte past its role's bound is refused ImageTooLarge naming the bound", async () => {
  const { held, service } = projectImagesFixture();
  const large = projectImagesArtifact("image/webp", "large");
  projectImagesStored(held, atlas, large, projectIconBytesMax + 1);
  assert.deepEqual(await service.name(administrator, atlas, "icon", large), {
    result: "ImageTooLarge",
    bytesMax: projectIconBytesMax,
  });
  assert.equal(
    (await service.name(administrator, atlas, "banner", large)).result,
    "Written",
    "the same bytes are within a banner's bound",
  );
  const wider = projectImagesArtifact("image/webp", "wider");
  projectImagesStored(held, atlas, wider, projectBannerBytesMax + 1);
  assert.deepEqual(await service.name(administrator, atlas, "banner", wider), {
    result: "ImageTooLarge",
    bytesMax: projectBannerBytesMax,
  });
  assert.deepEqual(held.writes, [`banner:administrator:${large}`]);
});

test("a store that cannot answer refuses the naming as unavailable and writes nothing", async () => {
  const { held, service } = projectImagesFixture();
  held.unavailable = true;
  assert.deepEqual(
    await service.name(
      administrator,
      atlas,
      "icon",
      projectImagesArtifact("image/png", "mark"),
    ),
    { result: "Unavailable", retryAfterSeconds: 3 },
  );
  assert.deepEqual(held.writes, []);
});

test("a caller who may not read the project reads no images of it", async () => {
  const { service } = projectImagesFixture();
  assert.deepEqual(await service.images(stranger, atlas), {
    result: "NotFound",
  });
  assert.deepEqual(await service.images(administrator, borealis), {
    result: "NotFound",
  });
});
