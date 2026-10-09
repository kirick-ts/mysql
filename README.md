# @kirick/mysql

A MySQL/MariaDB client for Node.js and Bun, with the core tagged-template API of
Bun SQL. The compatibility reference is **Bun 1.4.2**.

```ts
// Change only this import when moving supported code from Bun SQL.
import { SQL } from '@kirick/mysql';

const sql = new SQL('mysql://user:password@localhost/database');

await sql`INSERT INTO users ${sql([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
], 'name', 'email')}`;

const users = await sql<{ id: number; name: string }[]>`
  SELECT id, name FROM users
  WHERE id IN ${sql([1, 2, 3])}
  ORDER BY id
`;

await sql.close();
```

## Compatibility contract

The shared tests cover the same application code and assertions against both
implementations, on each supported database server:

- Explicit `new SQL(url)`, `new SQL(new URL(url))`, `new SQL(url, options)`, and
  `new SQL(options)` construction. `mysql://` and `mysql2://` URLs and the
  `mysql`/`mariadb` adapters are supported.
- Lazy, parameterized tagged-template queries and Promise chaining.
- Single/bulk inserts, selected columns, dynamic updates, and `IN`/`NOT IN`
  lists, including projection of a key from objects.
- Nested, conditional, and empty SQL fragments; escaped identifiers.
- Default object rows, `.values()` rows, and `.raw()` results.
- Bun's result-array metadata: `count`, `command`, `lastInsertRowid`, and
  `affectedRows`. Unchanged updates report zero affected rows.
- Numeric precision, `bigint: true`, UTC dates and timestamps, binary values,
  nullish bindings, and representative helper/database errors.
- Pool use, `connect()`, `.execute()`, graceful `close()`/`end()`, and async
  disposal.

The public `SQL.Options`, `SQL.Query<T>`, `SQL.Helper<T>`, and SQL error types
reference `bun-types@1.4.2` directly. The callable overloads also come from Bun's
`SQL` type. `T` describes the **whole result**, such as `User[]`, and `.raw()` and
`.values()` retain Bun's generic typing. Bun is a type dependency only: the
package does not import the Bun runtime on Node.js.

Transactions, reserved connections, PostgreSQL arrays/notifications, PostgreSQL
and SQLite adapters, automatic environment configuration, and startup
preconnection are unavailable. Excluded client methods are uncallable in the
Bun-derived type and absent at runtime. The compatibility contract is the subset
above, not every member or connection option present in Bun's declarations.
Advanced pool tuning, TLS modes, file/unsafe queries, multi-result queries, and
cancellation are not covered by the interoperability guarantee.

This replaces the previous `mysql(...).sql`, `sql.insert`, `sql.set`, and
`sql.id` API.

## Fragments and updates

```ts
const filter = sql`AND age >= ${18}`;
const table = 'users';
await sql`SELECT * FROM ${sql(table)} WHERE active = ${true} ${filter}`;

const user = { id: 1, name: 'Updated', email: 'updated@example.com' };
await sql`UPDATE users SET ${sql(user, 'name', 'email')} WHERE id = ${user.id}`;

const values = await sql`SELECT name, email FROM users ORDER BY id`.values();
const raw = await sql`SELECT name, email FROM users ORDER BY id`.raw();
```

An identifier is quoted as a single name. Bun 1.4.2 also treats `sql('db.table')`
as one name; qualify names using `${sql('db')}.${sql('table')}`.

A bulk helper takes its default columns from the **first row**. Columns undefined
in every row are omitted, allowing database defaults; missing entries in a
retained column bind as SQL NULL. Updates omit undefined properties. Empty
inserts/updates and empty `IN` lists follow Bun's failures rather than becoming
silent no-ops.

## Runtime details

`.raw()` matches the actual MySQL adapter, not just the simplified description
in the Bun guide. Numeric buffers use binary encodings (including three bytes for
MEDIUMINT); date/time and BIT(1) values keep their special decoded forms. Raw
parameter widths can differ between MySQL and MariaDB. Both providers must
produce the same result **on the same server**.

Bun 1.4.2 sends object/array value parameters using MySQL's JSON parameter type.
MariaDB 10.11 rejects that type with error 1210; this package preserves that
behavior. To store JSON on both engines, bind `JSON.stringify(value)`. Object
helpers for constructing INSERT/UPDATE statements are unaffected.

The implementation uses mysql2 for connections, authentication, prepared
statements, and result parsing. A query-local packet adapter supplies Bun's
parameter encodings; mysql2 otherwise encodes all numbers as doubles and bigints
as strings. It also invalidates cached statements when binding types change.
This relies on a small internal mysql2 boundary, so **mysql2 is pinned to 3.14.1**.
Run the full matrix before changing that dependency.

## Testing

Install dependencies and start Docker, then run:

```sh
bun install
bun run check
```

`check` runs `bun lint` (the `@kirick/lint` executable) followed by `bun run test`.
The test command builds first because tests import the built public package
exports. It then checks application and consumer types with `test:types`, verifies
both exports with Node's native loaders, and executes the Docker matrix.
`bun run test:docker` is an alias for `bun run test`. The `build` script retains
the standard `tsdown` command and its options; `.npmignore` filters development
files out of the published package.

The runner requires Bun 1.4.2 and Node.js, creates temporary MySQL 8.4.7 and
MariaDB 10.11.13 containers on random localhost ports, then runs every test file
with:

1. Bun's SQL client on Bun.
2. This package on Bun.
3. This package on Node.js through Vitest.

Containers use temporary storage and are removed after successful or failed
runs. The runner removes inherited database environment variables and disables
Bun's dotenv loading. Tests run in a non-UTC process timezone to verify UTC date
behavior. Override images with `SQL_TEST_MYSQL_IMAGE` and
`SQL_TEST_MARIADB_IMAGE` when checking other server releases.

The runner uses 16-character temporary passwords: the Bun 1.4.2 reference failed
MySQL caching_sha2_password authentication with the 32- and 36-character
passwords investigated during implementation. This is a reference-client
limitation, not a restriction imposed by this package.

To use an existing **disposable** database:

```sh
bun run build
SQL_CLIENT=bun SQL_TEST_URL='mysql://user:password@localhost/test' bun run test:shared
SQL_CLIENT=mysql SQL_TEST_URL='mysql://user:password@localhost/test' bun run test:shared
SQL_CLIENT=mysql SQL_TEST_URL='mysql://user:password@localhost/test' bun run test:vitest
```

Tests recreate tables named `compat_users`, `compat_values`, and `compat_client`.
Every test file dynamically selects its import using `SQL_CLIENT`; the default
is `mysql`, and invalid values are rejected. There are no provider-specific
expected results, skips, or result-normalization shims. Server-specific protocol
behaviors use the same expectations for both clients.
