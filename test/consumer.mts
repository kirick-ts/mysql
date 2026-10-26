import { SQL } from '@kirick/mysql';

const options: SQL.Options = {
	adapter: 'mysql',
	hostname: 'localhost',
	username: 'root',
	database: 'example',
};
const sql = new SQL(options);
const query: SQL.Query<{ id: number }[]> = sql<
	{ id: number }[]
>`SELECT id FROM users`;
const helper: SQL.Helper<{ id: number }> = sql({ id: 1 });
export { query, helper };

/** Verify the metadata aliases through the published ESM declarations. */
export async function metadata(): Promise<SQL.ResultMetadata> {
	const rows = await query;
	const {
		columns,
		statement,
	}: {
		columns: SQL.ResultColumn[] | null;
		statement: SQL.ResultStatement | null;
	} = rows;
	return { ...rows, columns, statement };
}
