import { afterAll, beforeAll, expect, test } from 'vitest';
import { databaseURL, metadata, options, provider } from '../test/config.js';

const { SQL } =
	provider() === 'bun' ? await import('bun') : await import('@kirick/mysql');
const sql = new SQL(databaseURL(), options);
afterAll(() => sql.close());
let isMariaDB = false;
const date = new Date('2026-01-02T03:04:05.678Z');
beforeAll(async () => {
	const version = await sql`SELECT VERSION() AS version`;
	isMariaDB = version[0].version.includes('MariaDB');
	await sql`DROP TABLE IF EXISTS compat_values`;
	await sql`
		CREATE TABLE compat_values (
				id INT PRIMARY KEY, tiny TINYINT, small SMALLINT, medium MEDIUMINT, uint INT UNSIGNED,
				big BIGINT, ubig BIGINT UNSIGNED, amount DECIMAL(20,3), f FLOAT, d DOUBLE,
				label VARCHAR(40), bytes BLOB, day DATE, stamp DATETIME(3), instant TIMESTAMP(3),
				duration TIME(6), flag BIT(1), bits BIT(9), year YEAR, nullable INT
			)
	`;
	await sql`INSERT INTO compat_values ${sql({
		id: 1,
		tiny: -2,
		small: -300,
		medium: -70000,
		uint: 4294967295,
		big: 9007199254740993n,
		ubig: 18446744073709551615n,
		amount: '123456789012345.123',
		f: 1.5,
		d: 2.25,
		label: 'hello 🐈',
		bytes: Buffer.from([0, 1, 255]),
		day: date,
		stamp: date,
		instant: date,
		duration: '123:04:05.678901',
		flag: true,
		bits: 257,
		year: 2026,
		nullable: null,
	})}`;
});

test('values preserves column order and duplicate names', async () => {
	const query = sql`SELECT label AS x, id AS x, nullable FROM compat_values`;
	expect(query.values()).toBe(query);
	expect(await query).toEqual(
		Object.assign([['hello 🐈', 1, null]], metadata(1)),
	);
	expect(await sql`SELECT label AS x, id AS x FROM compat_values`).toEqual(
		Object.assign([{ x: 1 }], metadata(1)),
	);
});

test('default results decode numbers, decimals, dates, buffers and bits', async () => {
	expect(await sql`SELECT * FROM compat_values`).toEqual(
		Object.assign(
			[
				{
					id: 1,
					tiny: -2,
					small: -300,
					medium: -70000,
					uint: 4294967295,
					big: '9007199254740993',
					ubig: '18446744073709551615',
					amount: '123456789012345.123',
					f: 1.5,
					d: 2.25,
					label: 'hello 🐈',
					bytes: Buffer.from([0, 1, 255]),
					day: new Date('2026-01-02T00:00:00.000Z'),
					stamp: date,
					instant: date,
					duration: '123:04:05',
					flag: true,
					bits: Buffer.from([1, 1]),
					year: 2026,
					nullable: null,
				},
			],
			metadata(1),
		),
	);
});

test('raw returns exact numeric wire bytes and preserves special decoded types', async () => {
	const query = sql`SELECT id, tiny, small, medium, uint, big, ubig, amount, f, d, label, bytes, day, stamp, duration, flag, bits, year, nullable FROM compat_values`;
	expect(query.raw()).toBe(query);
	expect(await query).toEqual(
		Object.assign(
			[
				[
					Buffer.from('01000000', 'hex'),
					Buffer.from('fe', 'hex'),
					Buffer.from('d4fe', 'hex'),
					Buffer.from('90eefe', 'hex'),
					Buffer.from('ffffffff', 'hex'),
					Buffer.from('0100000000002000', 'hex'),
					Buffer.from('ffffffffffffffff', 'hex'),
					Buffer.from('123456789012345.123'),
					Buffer.from('0000c03f', 'hex'),
					Buffer.from('0000000000000240', 'hex'),
					Buffer.from('hello 🐈'),
					Buffer.from([0, 1, 255]),
					new Date('2026-01-02T00:00:00.000Z'),
					date,
					'123:04:05',
					true,
					Buffer.from([1, 1]),
					Buffer.from('ea07', 'hex'),
					null,
				],
			],
			metadata(1),
		),
	);
});

test('raw parameter results use Bun integer and floating-point encodings', async () => {
	expect(
		await sql`SELECT ${1} AS n, ${-1} AS negative, ${true} AS yes, ${1.5} AS f, ${null} AS nil, ${'ok'} AS s`.raw(),
	).toEqual(
		Object.assign(
			[
				[
					Buffer.from(isMariaDB ? '01000000' : '0100000000000000', 'hex'),
					Buffer.from(isMariaDB ? 'ffffffff' : 'ffffffffffffffff', 'hex'),
					Buffer.from(isMariaDB ? '01' : '0100000000000000', 'hex'),
					Buffer.from('000000000000f83f', 'hex'),
					null,
					Buffer.from('ok'),
				],
			],
			metadata(1),
		),
	);
});

test('unaliased expressions preserve result column names', async () => {
	expect(await sql`SELECT ${1}`).toEqual(
		Object.assign([{ '?': 1 }], metadata(1)),
	);
});

test('bigint option preserves precision and small integers remain numbers', async () => {
	const client = new SQL(databaseURL(), { ...options, bigint: true });
	try {
		expect(await client`SELECT big, ubig, id FROM compat_values`).toEqual(
			Object.assign(
				[{ big: 9007199254740993n, ubig: 18446744073709551615n, id: 1 }],
				metadata(1),
			),
		);
	} finally {
		await client.close();
	}
});

test('BIGINT decoding uses signed and unsigned 32-bit boundaries', async () => {
	expect(
		await sql`SELECT CAST(2147483648 AS SIGNED) AS si, CAST(4294967295 AS UNSIGNED) AS ui, CAST(4294967296 AS UNSIGNED) AS large, ${2147483648} AS parameter`,
	).toEqual(
		Object.assign(
			[
				{
					si: '2147483648',
					ui: 4294967295,
					large: isMariaDB ? 0 : '4294967296',
					parameter: 2147483648,
				},
			],
			metadata(1),
		),
	);
});

test('objects and arrays interpolate as JSON text', async () => {
	const query = sql`SELECT ${{ a: 1 }} AS object, ${[1, 2]} AS array`;
	// MariaDB does not accept the MySQL JSON parameter type sent by Bun.
	if (isMariaDB) {
		await expect(Promise.resolve(query)).rejects.toMatchObject({
			code: 'ERR_MYSQL_SERVER_ERROR',
			errno: 1210,
			sqlState: 'HY000',
		});
	} else {
		expect(await query).toEqual(
			Object.assign([{ object: '{"a":1}', array: '[1,2]' }], metadata(1)),
		);
	}
});

test('typed array and buffer input preserves raw bytes', async () => {
	expect(
		await sql`SELECT ${new Uint8Array([0, 1, 255])} AS a, ${Buffer.from([128, 42])} AS b`.raw(),
	).toEqual(
		Object.assign(
			[[Buffer.from([0, 1, 255]), Buffer.from([128, 42])]],
			metadata(1),
		),
	);
});

test('dates bind and decode in UTC independent of process timezone', async () => {
	expect(await sql`SELECT ${date} AS d`).toEqual(
		Object.assign([{ d: date }], metadata(1)),
	);
	expect(await sql`SELECT @@session.time_zone AS timezone`).toEqual(
		Object.assign([{ timezone: '+00:00' }], metadata(1)),
	);
});

test('empty results preserve metadata in all formats', async () => {
	for (const query of [
		sql`SELECT * FROM compat_values WHERE id=9`,
		sql`SELECT * FROM compat_values WHERE id=9`.values(),
		sql`SELECT * FROM compat_values WHERE id=9`.raw(),
	]) {
		// oxlint-disable-next-line no-await-in-loop -- Exercise each result mode sequentially.
		expect(await query).toEqual(Object.assign([], metadata(0)));
	}
});

test('prepared statements can be reused with different parameter types', async () => {
	/** Reuse the same prepared statement template while parameter types change. */
	function query(value: unknown) {
		return sql`SELECT ${value} AS value`;
	}

	for (const value of [1, 'hi', null, 1.5, true, -3]) {
		// oxlint-disable-next-line no-await-in-loop -- Statement reuse requires sequential executions.
		expect(await query(value)).toEqual(
			Object.assign([{ value: value === true ? 1 : value }], metadata(1)),
		);
	}
});

test('parameters span null bitmap bytes and variable-length payload boundaries', async () => {
	const text = 'x'.repeat(251);
	const bytes = Buffer.alloc(65536, 143);
	expect(
		await sql`SELECT ${null} AS a, ${1} AS b, ${null} AS c, ${2} AS d, ${null} AS e, ${3} AS f, ${null} AS g, ${4} AS h, ${null} AS i, ${text} AS j, ${bytes} AS k`.raw(),
	).toEqual(
		Object.assign(
			[
				[
					null,
					Buffer.from(isMariaDB ? '01000000' : '0100000000000000', 'hex'),
					null,
					Buffer.from(isMariaDB ? '02000000' : '0200000000000000', 'hex'),
					null,
					Buffer.from(isMariaDB ? '03000000' : '0300000000000000', 'hex'),
					null,
					Buffer.from(isMariaDB ? '04000000' : '0400000000000000', 'hex'),
					null,
					Buffer.from(text),
					bytes,
				],
			],
			metadata(1),
		),
	);
});

test('values freezes helper bindings when the result mode is selected', async () => {
	const ids = [1];
	const query =
		sql`SELECT id FROM compat_values WHERE id IN ${sql(ids)}`.values();
	ids[0] = 9;
	expect(await query).toEqual(Object.assign([[1]], metadata(1)));
});

test('arbitrary output column names remain unchanged', async () => {
	expect(
		await sql`SELECT ${2} AS ${sql('CAST(? AS UNSIGNED)')}, ${3} AS ${sql('__proto__')}`,
	).toEqual(
		Object.assign(
			[
				Object.fromEntries([
					['CAST(? AS UNSIGNED)', 2],
					['__proto__', 3],
				]),
			],
			metadata(1),
		),
	);
});
