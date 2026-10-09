import type { SQL as BunSQL } from 'bun';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { databaseURL, metadata, options, provider } from '../test/config.js';

const { SQL } =
	provider() === 'bun' ? await import('bun') : await import('@kirick/mysql');
const sql = new SQL(databaseURL(), options);
afterAll(() => sql.close());
beforeAll(async () => {
	await sql`DROP TABLE IF EXISTS compat_client`;
	await sql`CREATE TABLE compat_client (id INT PRIMARY KEY AUTO_INCREMENT, label VARCHAR(50))`;
});

test('constructor accepts URL objects and options overrides', async () => {
	const client = new SQL(new URL(databaseURL()), options);
	try {
		expect(await client`SELECT 7 AS n`).toEqual(
			Object.assign([{ n: 7 }], metadata(1)),
		);
	} finally {
		await client.close();
	}
});

test('constructor accepts explicit object configuration', async () => {
	const url = new URL(databaseURL());
	const config: BunSQL.Options = {
		adapter: 'mysql',
		hostname: url.hostname,
		port: Number(url.port),
		username: url.username,
		password: url.password,
		database: url.pathname.slice(1),
		...options,
	};
	const client = new SQL(config);
	try {
		expect(await client`SELECT 1 AS n`).toEqual(
			Object.assign([{ n: 1 }], metadata(1)),
		);
	} finally {
		await client.end();
	}
});

test('mysql2 URL alias and mariadb adapter', async () => {
	const client = new SQL(databaseURL().replace('mysql:', 'mysql2:'), {
		...options,
		adapter: 'mariadb',
	});
	try {
		expect(await client`SELECT 1 AS n`).toEqual(
			Object.assign([{ n: 1 }], metadata(1)),
		);
	} finally {
		await client.close();
	}
});

test('connect returns the same callable client', async () => {
	expect(await sql.connect()).toBe(sql);
});

test('queries are lazy and execute only once', async () => {
	const query = sql`INSERT INTO compat_client ${sql({ id: 1, label: 'lazy' })}`;
	expect(query).toBeInstanceOf(Promise);
	expect(await sql`SELECT id FROM compat_client WHERE id=1`).toEqual(
		Object.assign([], metadata(0)),
	);
	const first = await query;
	expect(await query).toBe(first);
	expect(first).toEqual(Object.assign([], metadata(0, 1, 1)));
});

/* oxlint-disable promise/prefer-await-to-then -- This test verifies the Promise chaining API. */
test('execute, then, catch, and finally retain Promise behavior', async () => {
	const query = sql<{ n: number }[]>`SELECT 2 AS n`;
	expect(query.execute()).toBe(query);
	let isFinished = false;
	expect(
		await query
			.then((rows) => rows[0]!.n)
			.finally(() => {
				isFinished = true;
			}),
	).toBe(2);
	expect(isFinished).toBe(true);
	expect(
		await sql`SELECT missing_column FROM compat_client`.catch(
			(error) => error.errno,
		),
	).toBe(1054);
});

/* oxlint-enable promise/prefer-await-to-then */

test('concurrent queries use the same public API', async () => {
	const rows = await Promise.all([
		sql`SELECT ${1} AS n`,
		sql`SELECT ${2} AS n`,
		sql`SELECT ${3} AS n`,
	]);
	expect(rows).toEqual(
		[1, 2, 3].map((n) => Object.assign([{ n }], metadata(1))),
	);
});

test('result array metadata is enumerable; map produces ordinary arrays', async () => {
	const rows = await sql`SELECT 1 AS n`;
	expect(Object.keys(rows)).toEqual([
		'0',
		'count',
		'command',
		'lastInsertRowid',
		'affectedRows',
	]);
	expect(rows.count).toBe(1);
	expect(rows.command).toBeNull();
	expect(rows.lastInsertRowid).toBe(0);
	expect(rows.affectedRows).toBe(0);
	expect(Object.keys(rows.map((row: unknown) => row))).toEqual(['0']);
});

test('write metadata counts changed rows rather than matched rows', async () => {
	await sql`INSERT INTO compat_client ${sql({ id: 2, label: 'same' })}`;
	expect(
		await sql`UPDATE compat_client SET label=${'same'} WHERE id=2`,
	).toEqual(Object.assign([], metadata(0, 0, 0)));
	expect(
		await sql`UPDATE compat_client SET label=${'changed'} WHERE id=2`,
	).toEqual(Object.assign([], metadata(0, 0, 1)));
	expect(await sql`DELETE FROM compat_client WHERE id=2`).toEqual(
		Object.assign([], metadata(0, 0, 1)),
	);
});

test('database errors expose Bun error classes and properties', async () => {
	try {
		await sql`SELECT nonexistent FROM compat_client`;
		throw new Error('Expected query failure');
	} catch (error) {
		expect(error).toBeInstanceOf(SQL.MySQLError);
		expect(error).toBeInstanceOf(SQL.SQLError);
		expect(error).toMatchObject({
			name: 'MySQLError',
			code: 'ERR_MYSQL_SERVER_ERROR',
			errno: 1054,
			sqlState: '42S22',
		});
	}

	expect(await sql`SELECT 3 AS n`).toEqual(
		Object.assign([{ n: 3 }], metadata(1)),
	);
});

test('identifiers cannot be executed as queries', async () => {
	await expect(Promise.resolve(sql('compat_client'))).rejects.toMatchObject({
		code: 'ERR_MYSQL_NOT_TAGGED_CALL',
		message: 'Query not called as a tagged template literal',
	});
});

test('close is idempotent and prevents subsequent queries', async () => {
	const client = new SQL(databaseURL(), options);
	await client`SELECT 1`;
	await client.close();
	await client.close();
	await expect(Promise.resolve(client`SELECT 1`)).rejects.toMatchObject({
		code: 'ERR_MYSQL_CONNECTION_CLOSED',
		message: 'Connection closed',
	});
});

test('async disposal closes the pool', async () => {
	const client = new SQL(databaseURL(), options);
	await client`SELECT 1`;
	// eslint-disable-next-line unicorn/no-nonstandard-builtin-properties -- Required by the Bun SQL contract.
	await client[Symbol.asyncDispose]();
	await expect(Promise.resolve(client`SELECT 1`)).rejects.toMatchObject({
		code: 'ERR_MYSQL_CONNECTION_CLOSED',
	});
});

test('close drains explicitly started queries, including queued work', async () => {
	const client = new SQL(databaseURL(), { ...options, max: 1 });
	const first = client`SELECT SLEEP(0.02) AS n`.execute();
	const second = client`SELECT 2 AS n`.execute();
	await client.close();
	expect(await first).toEqual(Object.assign([{ n: 0 }], metadata(1)));
	expect(await second).toEqual(Object.assign([{ n: 2 }], metadata(1)));
});
