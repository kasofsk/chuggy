const root = process.argv[2];
const { migrations } = await import(
  `${root}/src/adapters/postgres/schema/migrations/index.ts`
);
for (const migration of migrations) {
  console.log(`=== ${migration.version} ${migration.name}`);
  for (const statement of migration.statements) console.log(statement);
}
