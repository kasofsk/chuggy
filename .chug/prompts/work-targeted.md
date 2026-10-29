# Implement the ticket, testing only what it changes

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

**Run only the tests that exercise your change.** Do not run
`.chug/tasks/ci.sh`, `just check`, `just check-full`, or a gate whose scope is
the whole tree, such as `.chug/tasks/check-source.sh`: the checks stage runs
`ci.sh` on your commit after you, and running it here only repeats it. Instead:

- the suites that test what you changed, and the ones you added, by path:
  `node --test --test-timeout=60000 <suite>...`;
- `./node_modules/.bin/tsc --noEmit` where you changed TypeScript, and
  `./node_modules/.bin/eslint` and `./node_modules/.bin/prettier --check` on
  the files you changed;
- for a gate you changed, its sibling `*.test.sh`.

Find the suites by what they import, not by name alone. A change no test can
exercise, such as a Dockerfile or a doc, needs none; say so in the report
rather than running something unrelated to stand in for it. Run anything slow
in the background and wait for it to finish, never under a foreground timeout
or a fixed sleep.

Commit the change yourself, with a message that carries its why, as the
reviewer's brief asks. The job has no git identity, so commit as the worker:
`git -c user.name='Chuggy Worker' -c user.email=worker@chuggy.invalid commit`.
At the attempt's end the worker adds a commit of its own on top, naming only
the ticket and the attempt and holding whatever you left uncommitted.

Report one result: a pass once the tests you ran are clean, naming each one, or
a failure naming what you could not satisfy and what stopped you.
