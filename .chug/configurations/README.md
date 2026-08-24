# Repository configurations

Direct JSON children of this directory declare configurations that Chuggy can
import from an exact repository commit. Each declaration is a strict envelope:

```json
{
  "version": 1,
  "name": "example",
  "configuration": {}
}
```

The inner document must satisfy the same release-readiness contract as a
configuration authored through the API. Nested declarations and symlinks are
not imported. Task instruction documents under `.chug/tasks/` are not
configuration declarations.
