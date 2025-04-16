import {
	describe,
	expect,
	test,
} from 'bun:test';
import { sql } from './sql.js';

describe('sql``', () => {
	test('no values', () => {
		expect(
			sql`SELECT 1`,
		).toStrictEqual({
			sql: 'SELECT 1',
			values: [],
		});
	});

	test('1 value', () => {
		const name = 'Alice';

		expect(
			sql`SELECT * FROM users WHERE name = ${name}`,
		).toStrictEqual({
			sql: 'SELECT * FROM users WHERE name = ?',
			values: [ 'Alice' ],
		});
	});

	test('2 values', () => {
		const name = 'Alice';

		expect(
			sql`SELECT * FROM users WHERE user_id = ${1} OR name = ${name}`,
		).toStrictEqual({
			sql: 'SELECT * FROM users WHERE user_id = ? OR name = ?',
			values: [ 1, 'Alice' ],
		});
	});

	// test('string', () => {
	// 	const name = 'Alice';

	// 	expect(
	// 		sql`SELECT * FROM users WHERE name = ${name}`,
	// 	).toStrictEqual({
	// 		sql: 'SELECT * FROM users WHERE name = ?',
	// 		values: [ 'Alice' ],
	// 	});
	// });

	// test('number', () => {
	// 	const user_id = 1;

	// 	expect(
	// 		sql`SELECT * FROM users WHERE user_id = ${user_id}`,
	// 	).toStrictEqual({
	// 		sql: 'SELECT * FROM users WHERE user_id = ?',
	// 		values: [ 1 ],
	// 	});
	// });

	// test('date', () => {
	// 	const date = new Date(1744804236086);

	// 	expect(
	// 		sql`SELECT * FROM users WHERE registered_at < ${date}`,
	// 	).toStrictEqual({
	// 		sql: 'SELECT * FROM users WHERE registered_at < ?',
	// 		values: [ '2025-04-16T11:50:36.086Z' ],
	// 	});
	// });
});

test('sql.id', () => {
	expect(
		sql`SELECT * FROM ${sql.id('users')} WHERE ${sql.id('user_id')} = ${1}`,
	).toStrictEqual({
		sql: 'SELECT * FROM ?? WHERE ?? = ?',
		values: [
			'users',
			'user_id',
			1,
		],
	});
});

describe('sql.insert', () => {
	test('one row', () => {
		expect(
			sql`INSERT INTO users ${sql.insert({
				name: 'Alice',
				email: 'alice@example.com',
			})}`,
		).toStrictEqual({
			sql: 'INSERT INTO users (??,??) VALUES (?,?)',
			values: [
				'name',
				'email',
				'Alice',
				'alice@example.com',
			],
		});
	});

	test('multiple rows', () => {
		expect(
			sql`INSERT INTO users ${sql.insert([
				{
					name: 'Alice',
					email: 'alice@example.com',
				},
				{
					name: 'Bob',
					email: 'bob@example.com',
				},
			])}`,
		).toStrictEqual({
			sql: 'INSERT INTO users (??,??) VALUES (?,?),(?,?)',
			values: [
				'name',
				'email',
				'Alice',
				'alice@example.com',
				'Bob',
				'bob@example.com',
			],
		});
	});
});

test('sql.set', () => {
	expect(
		sql`UPDATE users SET ${sql.set({
			name: 'Alice',
			email: 'alice@example.com',
		})}`,
	).toStrictEqual({
		sql: 'UPDATE users SET ??=?,??=?',
		values: [
			'name',
			'Alice',
			'email',
			'alice@example.com',
		],
	});
});
