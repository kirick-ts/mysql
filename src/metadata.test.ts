import type { SQL as BunSQL } from 'bun';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { databaseURL, metadata, options, provider } from '../test/config.js';

const { SQL } =
	provider() === 'bun' ? await import('bun') : await import('@kirick/mysql');
const sql = new SQL(databaseURL(), { ...options, max: 1 });
let isMariaDB = false;
afterAll(() => sql.close());
beforeAll(async () => {
	const [server] = await sql<
		{ version: string }[]
	>`SELECT VERSION() AS version`;
	isMariaDB = server!.version.includes('MariaDB');
	await sql`DROP TABLE IF EXISTS compat_metadata`;
	await sql`CREATE TABLE compat_metadata (id INT PRIMARY KEY AUTO_INCREMENT, label VARCHAR(20))`;
});
beforeEach(async () => {
	await sql`TRUNCATE compat_metadata`;
});

test('columns describe aliases, duplicate names and empty results in every mode', async () => {
	const columns: BunSQL.ResultColumn[] = [
		{ name: 'id', type: 3, table: 'm', length: 11, flags: 16899 },
		{ name: 'id', type: 3, table: 'm', length: 11, flags: 16899 },
		{ name: 'label', type: 253, table: 'm', length: 80, flags: 0 },
	];
	for (const query of [
		sql`SELECT m.id, m.id, m.label FROM compat_metadata AS m WHERE id=${1}`,
		sql`SELECT m.id, m.id, m.label FROM compat_metadata AS m WHERE id=${1}`.values(),
		sql`SELECT m.id, m.id, m.label FROM compat_metadata AS m WHERE id=${1}`.raw(),
	]) {
		// oxlint-disable-next-line no-await-in-loop -- Compare sequential executions of one prepared statement in each mode.
		const rows = await query;
		expect(rows).toHaveLength(0);
		expect(rows.count).toBe(0);
		expect(rows.columns).toEqual(columns);
		expect(rows.statement).toEqual({
			string:
				'SELECT m.id, m.id, m.label FROM compat_metadata AS m WHERE id=? ',
			types: [isMariaDB ? 6 : 8],
			columns,
		});
		expect(rows.statement!.columns).toBe(rows.columns);
	}
});

test('statement metadata is shared by repeated executions on one connection', async () => {
	const first = await sql`SELECT id FROM compat_metadata WHERE id=${1}`;
	const second =
		await sql`SELECT id FROM compat_metadata WHERE id=${2}`.values();
	expect(first.statement).toBe(second.statement);
	expect(first.columns).toBe(second.columns);
});

test('text, JSON and binary parameters retain their server column types', async () => {
	const rows =
		await sql`SELECT ${'a'} AS text, ${{ a: 1 }} AS json, ${Buffer.from([0, 1, 255])} AS bytes`;
	expect(rows.columns).toEqual([
		{
			name: 'text',
			type: isMariaDB ? 254 : 253,
			table: '',
			length: isMariaDB ? 4 : 65532,
			flags: isMariaDB ? 1 : 0,
		},
		{
			name: 'json',
			type: isMariaDB ? 254 : 253,
			table: '',
			length: isMariaDB ? 28 : 65532,
			flags: isMariaDB ? 1 : 0,
		},
		{
			name: 'bytes',
			type: isMariaDB ? 252 : 253,
			table: '',
			length: isMariaDB ? 3 : 65532,
			flags: isMariaDB ? 129 : 0,
		},
	]);
	expect(rows.statement!.types).toEqual(
		isMariaDB ? [6, 6, 6] : [253, 253, 253],
	);
});

test('changed server column descriptions preserve metadata on earlier results', async () => {
	const first = await sql`SELECT ${'a'} AS value`;
	const firstColumns = first.columns;
	const second = await sql`SELECT ${'abcd'} AS value`;
	expect(first.columns).toBe(firstColumns);
	expect(first.columns).toEqual([
		{
			name: 'value',
			type: isMariaDB ? 254 : 253,
			table: '',
			length: isMariaDB ? 4 : 65532,
			flags: isMariaDB ? 1 : 0,
		},
	]);
	expect(second.columns).toEqual([
		{
			name: 'value',
			type: isMariaDB ? 254 : 253,
			table: '',
			length: isMariaDB ? 16 : 65532,
			flags: isMariaDB ? 1 : 0,
		},
	]);
	expect(first.statement === second.statement).toBe(!isMariaDB);
});

test('columns and statement are prototype accessors while legacy metadata stays enumerable', async () => {
	const rows = await sql<{ n: number }[]>`SELECT 1 AS n`;
	expect(Object.keys(rows)).toEqual([
		'0',
		'count',
		'command',
		'lastInsertRowid',
		'affectedRows',
	]);
	expect(Object.hasOwn(rows, 'columns')).toBe(false);
	expect(Object.hasOwn(rows, 'statement')).toBe(false);
	expect(
		Object.getOwnPropertyDescriptor(Object.getPrototypeOf(rows), 'columns'),
	).toMatchObject({
		get: expect.any(Function),
		enumerable: false,
		configurable: true,
	});
	expect(
		Object.getOwnPropertyDescriptor(Object.getPrototypeOf(rows), 'statement'),
	).toMatchObject({
		get: expect.any(Function),
		set: expect.any(Function),
		enumerable: false,
		configurable: true,
	});
	expect(JSON.stringify(rows)).toBe('[{"n":1}]');
	expect([...rows]).toEqual([{ n: 1 }]);
});

test('write counts, generated IDs and parameter types describe inserted and changed rows', async () => {
	const inserted =
		await sql`INSERT INTO compat_metadata ${sql([{ label: 'A' }, { label: 'B' }])}`;
	expect(inserted).toMatchObject(metadata(2, 1, 2));
	expect(inserted.columns).toEqual([]);
	expect(inserted.statement).toEqual({
		string: 'INSERT INTO compat_metadata (`label`) VALUES(?),(?) ',
		types: isMariaDB ? [6, 6] : [253, 253],
		columns: [],
	});
	const updated =
		await sql`UPDATE compat_metadata SET ${sql({ label: 'C' })} WHERE id=${1}`;
	expect(updated).toMatchObject(metadata(1, 0, 1));
	expect(updated.statement).toEqual({
		string: 'UPDATE compat_metadata SET `label` = ?  WHERE id=? ',
		types: isMariaDB ? [6, 6] : [253, 8],
		columns: [],
	});
	const unchanged =
		await sql`UPDATE compat_metadata SET ${sql({ label: 'C' })} WHERE id=${1}`;
	expect(unchanged).toMatchObject(metadata(0));
	const deleted =
		await sql`DELETE FROM compat_metadata WHERE id IN ${sql([1, 2])}`;
	expect(deleted).toMatchObject(metadata(2, 0, 2));
	expect(deleted.statement!.string).toBe(
		'DELETE FROM compat_metadata WHERE id IN (?, ?) ',
	);
});

test('nested fragments expose the complete parameterized statement', async () => {
	const ids = sql([1, 2]);
	const filter = sql`WHERE id IN ${ids}`;
	const rows =
		await sql`SELECT ${sql('m.label')} FROM compat_metadata AS m ${filter} ${sql``}`;
	expect(rows.statement).toEqual({
		string: 'SELECT `m`.`label` FROM compat_metadata AS m WHERE id IN (?, ?)  ',
		types: isMariaDB ? [6, 6] : [8, 8],
		columns: [{ name: 'label', type: 253, table: 'm', length: 80, flags: 0 }],
	});
});

test('large generated IDs respect the bigint option', async () => {
	for (const bigint of [false, true]) {
		const client = new SQL(databaseURL(), { ...options, max: 1, bigint });
		try {
			// oxlint-disable-next-line no-await-in-loop -- Each client owns its temporary table and bigint setting.
			await client`CREATE TEMPORARY TABLE compat_large_id (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, label VARCHAR(10)) AUTO_INCREMENT=9007199254740993`;
			const inserted =
				// oxlint-disable-next-line no-await-in-loop -- Insert only after the temporary table exists.
				await client`INSERT INTO compat_large_id ${client({ label: 'A' })}`;
			expect(inserted.lastInsertRowid).toBe(
				bigint ? 9007199254740993n : '9007199254740993',
			);
			expect(inserted.count).toBe(1);
			expect(inserted.affectedRows).toBe(1);
		} finally {
			// oxlint-disable-next-line no-await-in-loop -- Close the client and its temporary table before testing the next setting.
			await client.close();
		}
	}
});
