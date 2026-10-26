# @kirick/mysql

A MySQL/MariaDB client for Node.js and Bun, with the core tagged-template API of
Bun SQL. The compatibility reference is **Bun 1.4.4**.

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
- Bun's result-array metadata: `count`, `command`, `lastInsertRowid`,
  `affectedRows`, `columns`, and `statement`. Writes report changed rows in both
  `count` and `affectedRows`; unchanged updates report zero.
- Numeric precision, `bigint: true`, UTC dates and timestamps, binary values,
  nullish bindings, and representative helper/database errors.
- Pool use, `connect()`, `.execute()`, graceful `close()`/`end()`, and async
  disposal.

The public `SQL.Options`, `SQL.Query<T>`, `SQL.Helper<T>`, `SQL.ResultMetadata`,
`SQL.ResultColumn`, `SQL.ResultStatement`, and SQL error types reference
`bun-types@1.4.4` directly. The callable overloads also come from Bun's
`SQL` type. `T` describes the **whole result**, such as `User[]`, and `.raw()` and
`.values()` retain Bun's generic typing. Awaited queries include typed result
metadata even with an explicit row type. Bun is a type dependency only: the
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

Bun 1.4.4 quotes each part of a dotted identifier: `sql('db.table')` produces
`` `db`.`table` ``. Separate `${sql('db')}.${sql('table')}` fragments also work.

A bulk helper takes its default columns from the **first row**. Columns undefined
in every row are omitted, allowing database defaults; missing entries in a
retained column bind as SQL NULL. Updates omit undefined properties. Empty
inserts and updates fail. Empty `IN` lists expand to `(NULL)`, so both `IN` and
`NOT IN` return no matches. Selecting `.raw()` or `.values()` leaves helper
bindings lazy until query execution.

## Runtime details

`.raw()` matches the actual MySQL adapter, not just the simplified description
in the Bun guide. Numeric buffers use binary encodings (including three bytes for
MEDIUMINT). Dates, times, and BIT values also return buffers; null stays null.
Default results preserve TIME microseconds. Raw parameter widths can differ
between MySQL and MariaDB. Both providers must
produce the same result **on the same server**.

Bun 1.4.4 binds object/array value parameters as JSON text on both MySQL and
MariaDB. This fixes the MariaDB error seen with Bun 1.4.2. Object helpers for
constructing INSERT/UPDATE statements are unaffected. `sql.json(value)` also
supports primitive JSON values such as strings, numbers, and JSON null.

Binary parameters use the blob wire type. MariaDB returns them as buffers;
MySQL can infer text columns for bare parameters and decode them as strings.
Use an explicit `CAST(... AS BINARY)` or `.raw()` when the bytes are required.
The shared tests compare these server-specific results for both providers.

`columns` and `statement` are non-enumerable prototype accessors. The older
`count`, `command`, `lastInsertRowid`, and `affectedRows` properties remain
own enumerable properties in Bun 1.4.4, despite its type comments describing
all metadata as prototype accessors. The shared tests preserve observed behavior.
Statement descriptions are shared while the server's column descriptions stay
the same; older results retain their descriptions when a later result changes.

The PostgreSQL-only `.readable()` and `.writable()` methods throw synchronously,
matching Bun's MySQL adapter.

The implementation uses mysql2 for connections, authentication, prepared
statements, and result parsing. A query-local packet adapter supplies Bun's
parameter encodings; mysql2 otherwise encodes all numbers as doubles and bigints
as strings. It also invalidates cached statements when binding types change.
Statement metadata also reads mysql2's prepared parameter descriptions.
These internal boundaries are why **mysql2 is pinned to 3.14.1**.
Run the full matrix before changing that dependency.

## Testing

Install dependencies and start Docker, then run:

```sh
bun install
bun run check
```

`check` runs `bun lint` (the `@kirick/lint` executable) followed by `bun run test`.
Lint automatically checks every root `tsconfig.json` and `tsconfig.*.json`,
including the ESM/CommonJS consumer fixtures in `tsconfig.consumer.json`.
The test command builds first because tests import the built public package
exports. It then verifies both exports with Node's native loaders and executes
the Docker matrix.
`bun run test:docker` is an alias for `bun run test`. The `build` script retains
the standard `tsdown` command and its options.

The runner requires Bun 1.4.4 and Node.js, creates temporary MySQL 8.4.7 and
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

The runner retains 16-character temporary passwords as a workaround introduced
when Bun 1.4.2 failed MySQL caching_sha2_password authentication with the 32- and
36-character passwords investigated during implementation. Those longer
passwords have not been rechecked against 1.4.4; this package imposes no such
password-length restriction.

To use an existing **disposable** database:

```sh
bun run build
SQL_CLIENT=bun SQL_TEST_URL='mysql://user:password@localhost/test' bun run test:shared
SQL_CLIENT=mysql SQL_TEST_URL='mysql://user:password@localhost/test' bun run test:shared
SQL_CLIENT=mysql SQL_TEST_URL='mysql://user:password@localhost/test' bun run test:vitest
```

Tests recreate tables named `compat_users`, `compat_values`, `compat_client`,
and `compat_metadata`.
Every test file dynamically selects its import using `SQL_CLIENT`; the default
is `mysql`, and invalid values are rejected. There are no provider-specific
expected results, skips, or result-normalization shims. Server-specific protocol
behaviors use the same expectations for both clients.
