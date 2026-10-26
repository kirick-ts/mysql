import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { databaseURL, metadata, options, provider } from '../test/config.js';

const { SQL } =
	provider() === 'bun' ? await import('bun') : await import('@kirick/mysql');
const sql = new SQL(databaseURL(), options);
afterAll(() => sql.close());
beforeAll(async () => {
	await sql`DROP TABLE IF EXISTS compat_users`;
	await sql`CREATE TABLE compat_users (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100), email VARCHAR(100), age INT DEFAULT 10)`;
});
beforeEach(async () => {
	await sql`TRUNCATE compat_users`;
});

test('template interpolation binds strings, numbers, booleans and nullish values', async () => {
	const text = "Robert'); DROP TABLE compat_users; -- \\ 🐈";
	expect(
		await sql`SELECT ${text} AS text, ${42} AS n, ${true} AS yes, ${false} AS no, ${null} AS nil, ${undefined} AS missing`,
	).toEqual(
		Object.assign(
			[{ text, n: 42, yes: 1, no: 0, nil: null, missing: null }],
			metadata(1),
		),
	);
});

test('insert a single object', async () => {
	const result =
		await sql`INSERT INTO compat_users ${sql({ name: 'Alice', age: 21 })}`;
	expect(result).toEqual(Object.assign([], metadata(1, 1, 1)));
	expect(await sql`SELECT * FROM compat_users`).toEqual(
		Object.assign(
			[{ id: 1, name: 'Alice', email: null, age: 21 }],
			metadata(1),
		),
	);
});

test('bulk insert and picking columns', async () => {
	const users = [
		{ name: 'Alice', email: 'a@example.com', age: 21 },
		{ name: 'Bob', email: 'b@example.com', age: 22 },
	];
	expect(
		await sql`INSERT INTO compat_users ${sql(users, 'name', 'email')}`,
	).toEqual(Object.assign([], metadata(2, 1, 2)));
	expect(
		await sql`SELECT name, email, age FROM compat_users ORDER BY id`,
	).toEqual(
		Object.assign(
			[
				{ name: 'Alice', email: 'a@example.com', age: 10 },
				{ name: 'Bob', email: 'b@example.com', age: 10 },
			],
			metadata(2),
		),
	);
});

test('single insert picks only requested columns', async () => {
	await sql`INSERT INTO compat_users ${sql({ name: 'Alice', age: 99 }, 'name')}`;
	expect(await sql`SELECT name, age FROM compat_users`).toEqual(
		Object.assign([{ name: 'Alice', age: 10 }], metadata(1)),
	);
});

test('bulk helpers use first-row keys and preserve selected column order', async () => {
	await sql`INSERT INTO compat_users ${sql([
		{ name: 'Alice', age: 1 },
		{ age: 2, name: 'Bob', email: 'ignored' },
	])}`;
	expect(
		await sql`SELECT name, age, email FROM compat_users ORDER BY id`,
	).toEqual(
		Object.assign(
			[
				{ name: 'Alice', age: 1, email: null },
				{ name: 'Bob', age: 2, email: null },
			],
			metadata(2),
		),
	);
});

test('undefined insert columns use defaults; missing values in retained columns use null', async () => {
	await sql`INSERT INTO compat_users ${sql([
		{ name: 'Alice', age: undefined },
		{ name: undefined, age: undefined },
	])}`;
	expect(await sql`SELECT name, age FROM compat_users ORDER BY id`).toEqual(
		Object.assign(
			[
				{ name: 'Alice', age: 10 },
				{ name: null, age: 10 },
			],
			metadata(2),
		),
	);
});

test('dynamic updates select columns and omit undefined values', async () => {
	await sql`INSERT INTO compat_users ${sql({ name: 'Before', age: 20 })}`;
	await sql`UPDATE compat_users SET ${sql({ name: 'After', age: 99, email: undefined }, 'name', 'email')} WHERE id=${1}`;
	expect(await sql`SELECT name, age, email FROM compat_users`).toEqual(
		Object.assign([{ name: 'After', age: 20, email: null }], metadata(1)),
	);
	await sql`UPDATE compat_users SET ${sql({ name: 'All', age: 30 })} WHERE id=${1}`;
	expect(await sql`SELECT name, age FROM compat_users`).toEqual(
		Object.assign([{ name: 'All', age: 30 }], metadata(1)),
	);
});

test('update helper adds SET when omitted', async () => {
	await sql`INSERT INTO compat_users ${sql({ name: 'Before' })}`;
	await sql`UPDATE compat_users ${sql({ name: 'After' })} WHERE id=${1}`;
	expect(await sql`SELECT name FROM compat_users`).toEqual(
		Object.assign([{ name: 'After' }], metadata(1)),
	);
});

test('IN primitive values and object projection', async () => {
	await sql`INSERT INTO compat_users ${sql([
		{ id: 1, name: 'A' },
		{ id: 2, name: 'B' },
		{ id: 3, name: 'C' },
	])}`;
	const expected = Object.assign([{ id: 1 }, { id: 3 }], metadata(2));
	expect(
		await sql`SELECT id FROM compat_users WHERE id IN ${sql([1, 3])} ORDER BY id`,
	).toEqual(expected);
	expect(
		await sql`SELECT id FROM compat_users WHERE id IN ${sql([{ id: 1 }, { id: 3 }], 'id')} ORDER BY id`,
	).toEqual(expected);
});

test('nested conditional fragments and empty fragments remain lazy', async () => {
	await sql`INSERT INTO compat_users ${sql([
		{ name: 'A', age: 20 },
		{ name: 'B', age: 40 },
	])}`;
	const age = sql`AND age > ${30}`;
	const filter = sql`WHERE name IN ${sql(['A', 'B'])} ${age}`;
	expect(await sql`SELECT name FROM compat_users ${filter} ${sql``}`).toEqual(
		Object.assign([{ name: 'B' }], metadata(1)),
	);
});

test('dynamic identifiers escape backticks; qualification uses separate identifiers', async () => {
	await sql`INSERT INTO ${sql('compat_users')} ${sql({ name: 'A' })}`;
	expect(
		await sql`SELECT ${sql('u')}.${sql('name')} AS ${sql('a`b')} FROM ${sql('compat_users')} AS ${sql('u')}`,
	).toEqual(Object.assign([{ 'a`b': 'A' }], metadata(1)));
});

test('dotted identifiers qualify each part and escape backticks', async () => {
	await sql`INSERT INTO compat_users ${sql({ name: 'A' })}`;
	expect(
		await sql`SELECT ${sql('u`.name')} AS name FROM compat_users AS ${sql('u`')}`,
	).toEqual(Object.assign([{ name: 'A' }], metadata(1)));
});

test('helpers can be reused without mutating input objects', async () => {
	const data = Object.freeze({ name: 'Reusable', age: 22 });
	const helper = sql(data);
	await sql`INSERT INTO compat_users ${helper}`;
	await sql`INSERT INTO compat_users ${helper}`;
	expect(await sql`SELECT name FROM compat_users ORDER BY id`).toEqual(
		Object.assign([{ name: 'Reusable' }, { name: 'Reusable' }], metadata(2)),
	);
	expect(data).toEqual({ name: 'Reusable', age: 22 });
});

test('parameterized LIMIT and OFFSET', async () => {
	await sql`INSERT INTO compat_users ${sql([{ name: 'A' }, { name: 'B' }, { name: 'C' }])}`;
	expect(
		await sql`SELECT name FROM compat_users ORDER BY id LIMIT ${1} OFFSET ${1}`,
	).toEqual(Object.assign([{ name: 'B' }], metadata(1)));
});

test('empty insert helpers fail', async () => {
	await expect(
		Promise.resolve(sql`INSERT INTO compat_users ${sql([])}`),
	).rejects.toThrow('Cannot INSERT with no columns');
	await expect(
		Promise.resolve(sql`INSERT INTO compat_users ${sql({ name: undefined })}`),
	).rejects.toThrow(
		'Insert needs to have at least one column with a defined value',
	);
});

test('empty updates and unsupported helper contexts fail', async () => {
	await expect(
		Promise.resolve(sql`UPDATE compat_users SET ${sql({})}`),
	).rejects.toThrow('Update needs to have at least one column');
	await expect(
		Promise.resolve(sql`UPDATE compat_users SET ${sql({ age: undefined })}`),
	).rejects.toThrow('Update needs to have at least one column');
	await expect(
		Promise.resolve(sql`SELECT ${sql({ name: 'A' })}`),
	).rejects.toThrow(
		'Helpers are only allowed for INSERT, UPDATE and IN commands',
	);
	await expect(
		Promise.resolve(
			sql`UPDATE compat_users SET ${sql([{ age: 1 }, { age: 2 }])}`,
		),
	).rejects.toThrow('Cannot use array of objects for UPDATE');
});

test('IN rejects multiple projection columns and accepts empty lists', async () => {
	await expect(
		Promise.resolve(
			sql`SELECT 1 WHERE 1 IN ${sql([{ id: 1, age: 2 }], 'id', 'age')}`,
		),
	).rejects.toThrow('Cannot use WHERE IN helper with multiple columns');
	expect(await sql`SELECT 1 WHERE 1 IN ${sql([])}`).toEqual(
		Object.assign([], metadata(0)),
	);
	expect(await sql`SELECT 1 WHERE 1 NOT IN ${sql([])}`).toEqual(
		Object.assign([], metadata(0)),
	);
});

test('integer parameters retain signed arithmetic and LIMIT comma syntax', async () => {
	expect(await sql`SELECT ${1} - ${2} AS difference`).toEqual(
		Object.assign([{ difference: -1 }], metadata(1)),
	);
	await sql`INSERT INTO compat_users ${sql([{ name: 'A' }, { name: 'B' }])}`;
	expect(
		await sql`SELECT name FROM compat_users ORDER BY id LIMIT ${1}, ${1}`,
	).toEqual(Object.assign([{ name: 'B' }], metadata(1)));
});

test('IN lists handle nullish entries and NOT IN', async () => {
	await sql`INSERT INTO compat_users ${sql([
		{ id: 1, name: 'A' },
		{ id: 2, name: 'B' },
	])}`;
	expect(
		await sql`SELECT id FROM compat_users WHERE id IN ${sql([undefined, 1, null])}`,
	).toEqual(Object.assign([{ id: 1 }], metadata(1)));
	expect(
		await sql`SELECT id FROM compat_users WHERE id NOT IN ${sql([1])}`,
	).toEqual(Object.assign([{ id: 2 }], metadata(1)));
});

test('helper objects retain Bun value and columns types and values', () => {
	const value = { id: 1, name: 'A' };
	expect(sql(value)).toMatchObject({ value: [value], columns: ['id', 'name'] });
	expect(sql([value], 'name')).toMatchObject({
		value: [value],
		columns: ['name'],
	});
});
