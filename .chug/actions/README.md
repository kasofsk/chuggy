# Repository actions

Direct JSON children of this directory declare a project's named actions: a
build, a deploy to one environment, a publish. An action is carried out by
whatever the project already uses for it and reported back; Chuggy does not run
it. Each declaration is a strict document:

```json
{
  "version": 1,
  "action": "deploy-production",
  "name": "Deploy to production",
  "repository": "github.com/example/service"
}
```

`action` is the identity every report names, and two declarations of one
identity are refused. `name` is for a reader. `repository` is the bound
repository whose commits the action acts on, and a declaration naming a
repository the project does not bind is refused. Any other field is refused
rather than ignored, so nothing here says how an action runs, what triggers it,
or where it executes.

Nested declarations and symlinks are not imported, and one refused declaration
refuses the commit's whole set.
