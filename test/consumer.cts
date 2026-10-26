// oxlint-disable-next-line typescript/no-require-imports -- Verify the published CommonJS consumer API.
import client = require('@kirick/mysql');

const sql = new client.SQL('mysql://root@localhost/example');
const query: client.SQL.Query<{ id: number }[]> = sql<
	{ id: number }[]
>`SELECT id FROM users`;
/** Verify typed metadata through the published CommonJS declarations. */
async function metadata(): Promise<client.SQL.ResultMetadata> {
	return await query;
}

export = { query, metadata };
