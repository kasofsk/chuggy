# Repository actions

Direct JSON children of this directory declare actions that Chuggy can import
from an exact repository commit. An action is something that happens to a
repository's commits — a build, a deploy to one environment, a publish — which
the project carries out with its own tooling and reports. Chuggy does not run
it. Each declaration is a strict document:

```json
{
  "version": 1,
  "action": "deploy-staging",
  "name": "Deploy to staging",
  "repository": "acme/engine"
}
```

`action` is the identity every report names, and is unique across the
directory. `name` is what a reader is shown. `repository` must be one the
project binds and has not retired, or the whole commit is refused. A field
the document does not declare is refused, never ignored.
