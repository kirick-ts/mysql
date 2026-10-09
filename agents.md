# Project requirements

## Compatibility goal

- Make `@kirick/mysql` compatible with the supported subset of Bun's SQL client, for MySQL and MariaDB servers only.
- Reference: https://bun.sh/docs/runtime/sql and Bun's corresponding TypeScript declarations.
- Application code using this subset must work by changing only the import package from `bun` to `@kirick/mysql`.
- Preserve both TypeScript usage and observable runtime behavior. Matching method names or accepting the same code is insufficient if results differ.
- This is subset compatibility; full structural assignability to Bun's entire `SQL` type is not required when unsupported members are omitted.

## Required functionality

- Explicit client creation through `SQL` and parameterized tagged-template queries.
- Inserting a single object and bulk inserting arrays of objects.
- Selecting which object columns to insert.
- Query result methods `.raw()` and `.values()`, as well as the default result format.
- SQL fragments, including nested and conditional fragments, empty fragments, and escaped dynamic identifiers.
- Dynamic columns in updates, using all object keys or an explicit selection.
- Dynamic value lists and `WHERE IN`, including lists projected from a selected object property.

Use Bun's public call patterns for these features, including `sql(data, ...columns)`, `sql(identifier)`, and `sql(values)`. Existing package-specific helpers must not be necessary for compatible application code.

## Explicit exclusions

- PostgreSQL and SQLite servers.
- Transaction APIs, including savepoints and distributed transactions.
- Automatic client creation or connection configuration from environment variables, including an environment-configured default client.
- Automatic runtime preconnection.

Test code may read database credentials from environment variables and pass them explicitly to the constructor. This does not authorize implicit environment configuration inside the client.

Other omissions suggested during API review are proposals, not confirmed requirements. Do not silently treat all previously suggested exclusions or additions as approved scope.

## Shared compatibility tests

- Every test file must dynamically import either Bun's SQL client or this package according to an environment variable.
- Use `SQL_CLIENT=bun` to select `await import('bun')` and `SQL_CLIENT=mysql` to select `await import('@kirick/mysql')`. Default to `mysql` when the variable is absent; reject other values clearly.
- Import this package through its public entry point. Build it before tests when package exports require built files.
- Provider selection may change only the imported implementation. Client construction, query code, fixtures, and assertions must be identical for both providers.
- Run every test file against both providers. Bun-provider runs require the Bun runtime.
- Require exactly the same runtime results for the supported API: result values and shapes, JavaScript value types, row and column ordering where specified, binary contents, null handling, and write-result metadata.
- Cover supported failure cases with the same assertions for both implementations.
- Do not use provider-specific expected results, skips, compatibility shims, casts that conceal type incompatibility, or result normalization to hide differences.
- Assert public behavior and database results rather than this package's private query representation, such as internal SQL strings or parameter arrays unavailable through Bun's public API.
- Use equivalent isolated database fixtures for each run. Control generated IDs and other variable inputs, and specify ordering where assertions depend on it, so comparison is meaningful.
- Exercise both MySQL and MariaDB with the same provider comparison strategy.
- Cover every required feature, including selected columns, nested fragments, duplicate column names in `.values()`, and `.raw()` buffer contents.
- Check TypeScript compatibility as well as runtime equality, including result generics and supported public types. Changing the provider must not require changing type arguments or application annotations.
- Record the Bun version used as the compatibility reference. When documentation and observed behavior disagree, investigate against that version before claiming parity.

## Implementation and validation requirements

- Reuse Bun's published SQL declarations instead of independently recreating public query, helper, and options interfaces. The reference is `bun-types@1.4.2` and Bun runtime 1.4.2.
- Temporary MySQL and MariaDB Docker containers are authorized for testing. Package scripts may create them. Isolate their ports and storage, and clean up only containers created by the test run.
- Lint the codebase with `bun lint`, using the executable supplied by `@kirick/lint`. Do not add a package script that shadows it or replace it with individual lint tools.
- Fix Oxlint warnings where the code can be improved. For necessary behavior such as test logging or explicit test environment access, suppress the specific warning at that line with a reason; do not disable warnings across the codebase.
- Include TypeScript tool configuration files in type checking so dependency upgrades cannot leave invalid build/test configurations undetected.
- Preserve the user's `build` script and its standard `tsdown` command-line options. Add test commands without replacing the existing lint/build setup.
- `check` is the one-shot command to lint, test, and build dist. Include `bun run build` in `test` only when tests exercise built output; otherwise it belongs in `check`.
- The current tests import the built public package exports, so `test` builds first, runs `test:types` (including ESM/CommonJS consumer fixtures), and runs the shared Docker matrix. `check` runs `bun lint && bun run test`.
- Preserve `.npmignore` as the package publication filter. Extend it for new development files instead of deleting it or replacing it with a `package.json` files allowlist.
- Keep mysql2 pinned while the parameter adapter uses its packet-writing boundary; validate upgrades with the full matrix.
- Match runtime behavior on the same database server. MySQL and MariaDB may legitimately produce different wire types; any server-specific expectations must be identical for both providers.
- Document discrepancies found in the Bun reference rather than changing expectations for our provider. See README.md for the verified contract and observed Bun 1.4.2 limitations.
