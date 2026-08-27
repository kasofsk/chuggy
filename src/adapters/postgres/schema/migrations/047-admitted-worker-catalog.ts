import { repositoryConfigurationNameCharsMax } from "../../../../interpreter/repositoryConfigurationIdentity.ts";
import {
  workerImageCharsMax,
  workerVersionCharsMax,
} from "../../../../interpreter/workerCatalog.ts";
import { apiRole, schedulerRole, type Migration } from "../shared.ts";

/**
 * The catalog of labels the admitted images are published under, installation
 * wide because the images a scheduler admits are, and never partitioned by the
 * projects that happen to run on them.
 *
 * A ROW IS NEVER DELETED. An execution that ran on an image a later release
 * retired still reads back under the label it ran as, so a publication updates
 * what it names and leaves the rest standing.
 *
 * A LABEL IS UNIQUE IN THE LIST THAT PUBLISHED IT AND NOWHERE ELSE. The image
 * is the only key here: a table-wide unique label would outlive every release
 * that ever held it, and the first rebuild reusing a version string would be a
 * boot no deployment could recover from, because nothing here may delete.
 *
 * `published_at` IS THE LAST PUBLICATION AND NOT THE FIRST, which is what tells
 * a live entry from one no release has named since.
 */
export const migration047: Migration = {
  version: 47,
  name: "the admitted worker catalog",
  statements: [
    `CREATE TABLE admitted_worker (
       image        text NOT NULL PRIMARY KEY,
       name         text NOT NULL,
       version      text NOT NULL,
       published_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT admitted_worker_image_is_bounded CHECK (
         length(image) BETWEEN 1 AND ${workerImageCharsMax}),
       CONSTRAINT admitted_worker_name_is_bounded CHECK (
         length(name) BETWEEN 1 AND ${repositoryConfigurationNameCharsMax}),
       CONSTRAINT admitted_worker_version_is_bounded CHECK (
         length(version) BETWEEN 1 AND ${workerVersionCharsMax})
     )`,
    `GRANT SELECT, INSERT, UPDATE ON admitted_worker TO ${schedulerRole}`,
    `GRANT SELECT ON admitted_worker TO ${apiRole}`,
  ],
};
