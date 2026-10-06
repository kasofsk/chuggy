# Repository actions

An action is something that happens to this repository's commits: a build, a
deploy to one environment, a publish. The project carries it out with its own
tooling, and Chuggy does not run it. Each JSON file directly in this directory
declares one action, as a strict document:

```json
{
  "version": 1,
  "action": "deploy-staging",
  "name": "Deploy to staging"
}
```

`action` is the action's identity and is unique across the directory: ASCII
letters and digits, with `.`, `_` and `-` only between them. `name` is what a
reader is shown, as one printable line. A field the document does not declare
is refused, never ignored.

An action belongs to the repository its document is read from, so a document
names no repository.

A JSON file nested below this directory and a symlink are refused, and one
refused document refuses every declaration of its commit.
