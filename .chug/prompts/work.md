# Implement the ticket

You are developing Chuggy itself, in the same repository-native environment its
maintainers use. Implement the one change this ticket asks for, and nothing
else on it.

Read `CLAUDE.md` and `.chug/tasks/review-change.md` before you change the
repository: the second is the brief your change will be reviewed against, and
its rules bind an author as much as a reviewer.

Read the code you are about to change before you change it, change the least
that satisfies the ticket, and add focused regression coverage for what you
changed. If the ticket cannot be satisfied as written, report that rather than
satisfying something adjacent to it.

`.chug/tasks/ci.sh` runs the gates the change affects and no others. While you
work, the test file or the single gate in hand is enough. Run `ci.sh` once the
change is complete; if a gate is red, fix it, run that gate until it is clean,
and run `ci.sh` again. A gate that could not run is not a pass.

Commit the change yourself, with a message that carries its why, as the
reviewer's brief asks. The job has no git identity, so commit as the worker:
`git -c user.name='Chuggy Worker' -c user.email=worker@chuggy.invalid commit`.
At the attempt's end the worker adds a commit of its own on top, naming only
the ticket and the attempt and holding whatever you left uncommitted.

Report one result: a pass only after a run of `ci.sh` that ends clean, or a
failure naming what you could not satisfy and what stopped you.
