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
`.chug/tasks/ci.sh` on its own, `just check`, `just check-full`, or
`.chug/tasks/check-source.sh --unit`: the checks stage runs `ci.sh` on your
commit after you, and running it here only repeats it.

Every command's output lands in your context, so run each one to print its
verdict and only what failed: send the output to a file outside the tree, print
the exit code, and read the failures from the file, never the whole of it.

- The suites that test what you changed, and the ones you added, by path. The
  dot reporter prints a line of dots and then the failures, so dropping the
  dots leaves nothing on a pass:
  `node --test --test-reporter=dot --test-timeout=60000 <suite>... >/tmp/unit.out 2>&1; echo "exit $?"; grep -v '^[.X]*$' /tmp/unit.out | head -n 60`
- On the files you changed:
  `./node_modules/.bin/tsc --noEmit --pretty false >/tmp/tsc.out 2>&1; echo "exit $?"; head -n 40 /tmp/tsc.out`,
  `env CHUG_SAFEQL_DATABASE_URL= ./node_modules/.bin/eslint --quiet <file>... >/tmp/lint.out 2>&1; echo "exit $?"; head -n 40 /tmp/lint.out`
  and `./node_modules/.bin/prettier --check --log-level warn <file>...; echo "exit $?"`.
- For a gate you changed, its sibling suite:
  `sh .chug/tasks/<gate>.test.sh >/tmp/suite.out 2>&1; echo "exit $?"; grep -A3 '^FAIL' /tmp/suite.out | head -n 40`.
- For a gate whose rule your change may break, the gate itself through
  `ci.sh`, which records a pass the checks stage then reuses instead of running
  it again: `git add -A; CHUG_CI_QUIET=1 .chug/tasks/ci.sh --only <gate>... >/tmp/ci.out 2>&1; echo "exit $?"; tail -n 60 /tmp/ci.out`.
  `ci.sh` refuses a file git does not track, which is why it is added first.
  Name the gates by the ids `ci.sh --only` lists, and leave out
  `source-unit` and the database gates, which are the checks stage's.

Find the suites by what they import, not by name alone. A change no test can
exercise, such as a Dockerfile or a doc, needs none; say so in the report
rather than running something unrelated to stand in for it. Run anything slow
in the background and wait for it to finish, never under a foreground timeout
or a fixed sleep, and never start a run while another is still going.

Commit the change yourself, with a message that carries its why, as the
reviewer's brief asks. The job has no git identity, so commit as the worker:
`git -c user.name='Chuggy Worker' -c user.email=worker@chuggy.invalid commit`.
At the attempt's end the worker adds a commit of its own on top, naming only
the ticket and the attempt and holding whatever you left uncommitted.

Report one result: a pass once the tests you ran are clean, naming each one, or
a failure naming what you could not satisfy and what stopped you.
