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

A version 2 configuration is a catalog: workloads, the evaluation plans that
run them, and the defaults a ticket takes where it selects none. A workload may
be a path to a JSON file holding one, and a prompt may name the file holding
its text; both are paths under `.chug/`, read at the commit the import reads
and stored inline. This tree's catalogs keep their prompts in `.chug/prompts/`
and the workloads they share in `.chug/workloads/`, and its reviewer's prompt is
`.chug/tasks/review-change.md` itself.

The `version` above is the envelope's schema version, not the configuration's.
A configuration's own version is a number the server assigns on import: one per
name, one per distinct declaration digest, in the order the imports arrived, so
the same bytes at a later commit keep their number and changed bytes take the
next one. It is a label rather than an identity — what names a revision is still
`repository:<commit>:<name>`, and a revision authored through the API has no
number at all.
