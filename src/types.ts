/// <reference types="bun-types" preserve="true" />
import type { SQL as BunSQL } from 'bun';

// Keep Bun's generic call overloads intact. Omit<SQL, ...> erases them.
// Unsupported methods are uncallable; they are not installed at runtime.
type Unsupported =
	| 'begin'
	| 'transaction'
	| 'beginDistributed'
	| 'distributed'
	| 'commitDistributed'
	| 'rollbackDistributed'
	| 'reserve'
	| 'listen'
	| 'notify'
	| 'array'
	| 'flush';

export type SQL = BunSQL & Record<Unsupported, never>;

// oxlint-disable-next-line typescript/no-namespace -- Preserve Bun SQL.Options, SQL.Query, and SQL.Helper type names.
export declare namespace SQL {
	export type Options = BunSQL.Options;
	export type Query<T> = BunSQL.Query<T>;
	export type ResultMetadata = BunSQL.ResultMetadata;
	export type ResultColumn = BunSQL.ResultColumn;
	export type ResultStatement = BunSQL.ResultStatement;
	export type Helper<T> = BunSQL.Helper<T>;
	export type MySQLError = BunSQL.MySQLError;
	export type SQLError = BunSQL.SQLError;
}

export type SQLConstructor = Pick<typeof BunSQL, 'SQLError' | 'MySQLError'> & {
	new (url: string | URL, options?: BunSQL.PostgresOrMySQLOptions): SQL;
	new (options: BunSQL.PostgresOrMySQLOptions): SQL;
};
