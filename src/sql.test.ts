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
		).toMatchObject({
			sql: 'SELECT 1',
			values: [],
		});
	});

	test('1 value', () => {
		const name = 'Alice';

		expect(
			sql`SELECT * FROM users WHERE name = ${name}`,
		).toMatchObject({
			sql: 'SELECT * FROM users WHERE name = ?',
			values: [ 'Alice' ],
		});
	});

	test('2 values', () => {
		const name = 'Alice';

		expect(
			sql`SELECT * FROM users WHERE user_id = ${1} OR name = ${name}`,
		).toMatchObject({
			sql: 'SELECT * FROM users WHERE user_id = ? OR name = ?',
			values: [ 1, 'Alice' ],
		});
	});

	test('array', () => {
		const names = [ 'Alice', 'Bob' ];

		expect(
			sql`SELECT * FROM users WHERE name IN (${names})`,
		).toMatchObject({
			sql: 'SELECT * FROM users WHERE name IN (?,?)',
			values: [ 'Alice', 'Bob' ],
		});
	});

	test('array of arrays', () => {
		const names = [
			[ 'Alice', 'alice@example.com' ],
			[ 'Bob', 'bob@example.com' ],
		];

		expect(
			sql`INSERT INTO users (name, email) VALUES ${names}`,
		).toMatchObject({
			sql: 'INSERT INTO users (name, email) VALUES (?,?),(?,?)',
			values: [
				'Alice',
				'alice@example.com',
				'Bob',
				'bob@example.com',
			],
		});
	});

	test('nested sql', () => {
		const name = 'Alice';

		expect(
			sql`SELECT * FROM users WHERE user_id = ${1} ${'test' in globalThis ? sql.empty : sql`OR name = ${name}`}`,
		).toMatchObject({
			sql: 'SELECT * FROM users WHERE user_id = ? OR name = ?',
			values: [ 1, 'Alice' ],
		});
	});
});

test('sql.id', () => {
	expect(
		sql`SELECT * FROM ${sql.id('users')} WHERE ${sql.id('user_id')} = ${1}`,
	).toMatchObject({
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
		).toMatchObject({
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
		).toMatchObject({
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
	).toMatchObject({
		sql: 'UPDATE users SET ??=?,??=?',
		values: [
			'name',
			'Alice',
			'email',
			'alice@example.com',
		],
	});
});
