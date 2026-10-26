import type { SQL as PackageSQL } from '@kirick/mysql';
import type { SQL as BunSQL } from 'bun';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
type Assert<T extends true> = T;
// These aliases must remain the upstream types, not locally copied interfaces.
export type OptionsAreBun = Assert<Equal<PackageSQL.Options, BunSQL.Options>>;
export type QueryIsBun = Assert<
	Equal<PackageSQL.Query<{ id: number }[]>, BunSQL.Query<{ id: number }[]>>
>;
export type HelperIsBun = Assert<
	Equal<PackageSQL.Helper<{ id: number }>, BunSQL.Helper<{ id: number }>>
>;
export type MetadataIsBun = Assert<
	Equal<PackageSQL.ResultMetadata, BunSQL.ResultMetadata>
>;
export type ColumnIsBun = Assert<
	Equal<PackageSQL.ResultColumn, BunSQL.ResultColumn>
>;
export type StatementIsBun = Assert<
	Equal<PackageSQL.ResultStatement, BunSQL.ResultStatement>
>;
export type AwaitedQueryIncludesMetadata = Assert<
	Equal<
		Awaited<PackageSQL.Query<{ id: number }[]>>,
		{ id: number }[] & BunSQL.ResultMetadata
	>
>;

/** Metadata remains typed when callers supply their own row type. */
export async function typedMetadata(
	sql: PackageSQL | BunSQL,
): Promise<BunSQL.ResultMetadata> {
	const rows = await sql<{ id: number }[]>`SELECT id FROM users`;
	const {
		count,
		columns,
		statement,
	}: {
		count: number;
		columns: PackageSQL.ResultColumn[] | null;
		statement: PackageSQL.ResultStatement | null;
	} = rows;
	return {
		count,
		columns,
		statement,
		command: rows.command,
		affectedRows: rows.affectedRows,
		lastInsertRowid: rows.lastInsertRowid,
	};
}

// The same application body must compile with either client, without assertions.
/** Compile the same application code against both client types. */
export function application(
	sql: PackageSQL | BunSQL,
): BunSQL.Query<{ id: number }[]> {
	const rows = [{ id: 1, name: 'Alice' }] as const;
	const helper: BunSQL.Helper<{ readonly id: 1 }> = sql(rows, 'id');
	const query: BunSQL.Query<{ id: number }[]> = sql<
		{ id: number }[]
	>`SELECT id FROM users WHERE id IN ${helper}`;
	const fragment = sql`AND name = ${'Alice'}`;
	sql`SELECT id FROM users WHERE id IN ${sql([1, 2])} ${fragment}`.values();
	sql`SELECT id FROM users`.raw();
	return query;
}

/** Check that excluded operations and invalid columns fail type checking. */
export function invalidUsage(sql: PackageSQL): void {
	// @ts-expect-error The package excludes transactions.
	sql.begin(() => undefined);
	// @ts-expect-error Picked columns must exist on the input object.
	sql({ id: 1 }, 'nonexistent');
}
