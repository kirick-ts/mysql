import { readFile } from 'node:fs/promises';
import type { SQL as BunSQL } from 'bun';
import { MySQLError, SQLError } from './errors.js';
import { optionsFrom } from './options.js';
import { ClientPool } from './pool.js';
import { Query } from './query.js';
import { type Compiled, compile, identifier, SQLHelper } from './sql.js';
import type { SQL as Client, SQLConstructor } from './types.js';

/** Create a callable SQL client with a lazily initialized connection pool. */
function createSQL(
	input: string | URL | BunSQL.PostgresOrMySQLOptions,
	overrides: BunSQL.PostgresOrMySQLOptions = {},
): Client {
	const options = optionsFrom(input, overrides);
	const pool = new ClientPool(options);
	/** Preserve the query runner's receiver when passing it to lazy queries. */
	function run<T>(query: Query<T>): Promise<T & BunSQL.ResultMetadata> {
		return pool.run(query);
	}

	/** Share the same close function between the public lifecycle aliases. */
	function close(config?: { timeout?: number }): Promise<void> {
		return pool.close(config);
	}

	/** Dispatch the upstream template, identifier, and data-helper overloads. */
	function sql(first: unknown, ...values: unknown[]): unknown {
		if (typeof first === 'string') {
			const text = identifier(first);
			return new Query(
				() => {
					return { text, values: [] };
				},
				run,
				true,
			);
		}

		if (Array.isArray(first) && 'raw' in first) {
			return new Query(
				() => compile(first as unknown as TemplateStringsArray, values),
				run,
			);
		}

		return new SQLHelper(
			Array.isArray(first) ? first : [first],
			values as string[],
		);
	}

	/** Construct a query from explicitly supplied SQL text. */
	function unsafe(text: string, values: unknown[] = []): Query<unknown> {
		const query = new Query((): Compiled => {
			return { text, values };
		}, run);
		if (values.length === 0) {
			query.simple();
		}

		return query;
	}

	Object.assign(sql, {
		options,
		json: (value: unknown) => JSON.stringify(value),
		unsafe,
		close,
		end: close,
		file: async (path: string, values: unknown[] = []) =>
			unsafe(await readFile(path, 'utf8'), values),
		connect: async () => {
			await pool.connect();
			return sql;
		},
		// eslint-disable-next-line unicorn/no-nonstandard-builtin-properties -- Required by Bun SQL AsyncDisposable.
		[Symbol.asyncDispose]: close,
	});
	return sql as Client;
}

export const SQL: SQLConstructor = Object.assign(
	/* oxlint-disable prefer-arrow-callback -- SQL must support new SQL(...). */
	// eslint-disable-next-line func-names -- Preserve the public constructor name.
	function SQL(
		this: unknown,
		input: string | URL | BunSQL.PostgresOrMySQLOptions,
		options?: BunSQL.PostgresOrMySQLOptions,
	) {
		return createSQL(input, options);
	},
	{ SQLError, MySQLError },
) as unknown as SQLConstructor;
/* oxlint-enable prefer-arrow-callback */

export type SQL = Client;
// oxlint-disable-next-line typescript/no-namespace -- Preserve Bun SQL.Options, SQL.Query, and SQL.Helper type names.
export declare namespace SQL {
	export type Options = BunSQL.Options;
	export type PostgresOrMySQLOptions = BunSQL.PostgresOrMySQLOptions;
	export type Query<T> = BunSQL.Query<T>;
	export type ResultMetadata = BunSQL.ResultMetadata;
	export type ResultColumn = BunSQL.ResultColumn;
	export type ResultStatement = BunSQL.ResultStatement;
	export type Helper<T> = BunSQL.Helper<T>;
	export type MySQLError = BunSQL.MySQLError;
	export type SQLError = BunSQL.SQLError;
}
