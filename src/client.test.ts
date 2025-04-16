import {
	expect,
	test,
} from 'bun:test';
import type { ResultSetHeader } from 'mysql2';
import { mysql } from './client.js';
import { sql } from './sql.js';

const mysqlClient = mysql({
	host: Bun.env.MYSQL_HOST!,
	user: Bun.env.MYSQL_USER!,
	password: Bun.env.MYSQL_PASSWORD!,
	database: Bun.env.MYSQL_DATABASE!,
});

const variant_name = Math.random()
	.toString(36)
	.slice(2);

test('insert', async () => {
	const result = await mysqlClient.sql<ResultSetHeader>`INSERT INTO variant_ids ${sql.insert({ variant_name })}`;

	expect(result.affectedRows).toBe(1);
	expect(typeof result.insertId).toBe('number');
});

test('select', async () => {
	const result = await mysqlClient.sql<{
		variant_id: number,
		variant_name: string,
	}[]>`SELECT * FROM variant_ids WHERE variant_name = ${variant_name}`;

	expect(result.length).toBe(1);
	expect(typeof result[0].variant_id).toBe('number');
	expect(result[0].variant_name).toBe(variant_name);
});

test('delete', async () => {
	const result = await mysqlClient.sql<ResultSetHeader>`DELETE FROM variant_ids WHERE variant_name = ${variant_name}`;

	expect(result.affectedRows).toBe(1);
	expect(result.insertId).toBe(0);
});
