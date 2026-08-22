# PostgreSQL adapter

- PostgreSQL itself is the authority for concurrency, privileges, schema, and
  query-shape claims.
- Keep adapter queries visible to the `sql` tag and SafeQL rules in
  `eslint.config.js`.
- Run `.chug/tasks/check-postgres.sh` and `.chug/tasks/check-queries.sh` after
  relevant changes. They require Docker or `CHUG_PG_URL`; inability to acquire
  a server is not a pass.
