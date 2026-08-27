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

The `version` above is the envelope's schema version, not the configuration's.
A configuration's own version is a number the server assigns on import: one per
name, one per distinct declaration digest, in the order the imports arrived, so
the same bytes at a later commit keep their number and changed bytes take the
next one. It is a label rather than an identity — what names a revision is still
`repository:<commit>:<name>`, and a revision authored through the API has no
number at all.
