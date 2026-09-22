// Renders every migration a tree declares, as the ledger would apply it.
const root = process.argv[2];
const { migrations } = await import(
  `${root}/src/adapters/postgres/schema/migrations/index.ts`
);
for (const { version, name, statements } of migrations) {
  console.log(`-- migration ${version}: ${name}`);
  for (const statement of statements) console.log(`${statement};`);
  console.log("");
}
