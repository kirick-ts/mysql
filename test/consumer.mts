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
