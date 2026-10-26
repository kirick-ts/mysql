import type { SQL } from './types.js';

export type Compiled = { text: string; values: unknown[] };
export type Fragment = { compile(): Compiled };
export const fragment: unique symbol = Symbol('SQL fragment');

/** Quote each part of a qualified MySQL identifier. */
export function identifier(name: string): string {
	if (name.includes('\0')) {
		throw new TypeError('SQL identifiers must not contain null bytes');
	}

	return '`' + name.replaceAll('`', '``').replaceAll('.', '`.`') + '`';
}

export class SQLHelper implements SQL.Helper<Record<string, unknown>> {
	readonly value: Record<string, unknown>[];
	readonly columns: string[];

	constructor(value: unknown[], columns: string[]) {
		this.value = value as Record<string, unknown>[];
		this.columns =
			columns.length === 0 && value[0] !== null && typeof value[0] === 'object'
				? Object.keys(value[0])
				: columns;
		for (const key of this.columns) {
			const number = Number(key);
			if (
				(typeof key !== 'string' || !Number.isNaN(number))
				&& (!Number.isSafeInteger(number) || number < 0 || number > 65536)
			) {
				throw new Error(`Keys must be strings or numbers: ${String(key)}`);
			}
		}
	}
}

/** Find the command that determines how a data helper expands. */
function command(text: string): string {
	// Walk backwards like Bun: the closest command determines helper expansion.
	const tokens = text
		.toLowerCase()
		.replaceAll(/"[^"]*"/gu, '')
		.trim()
		.split(/\s+/u);
	return (
		tokens.findLast((token) =>
			['insert', 'update', 'set', 'where', 'in'].includes(token),
		) ?? ''
	);
}

/** Normalize binary and nullish parameters without interpolating SQL text. */
function bind(value: unknown, values: unknown[], _prefix: string): string {
	if (value === null || value === undefined) {
		values.push(null);
	} else if (ArrayBuffer.isView(value)) {
		values.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
	} else if (value instanceof ArrayBuffer) {
		values.push(Buffer.from(value));
	} else {
		values.push(value);
	}

	return '?';
}

/** Expand a helper according to its INSERT, UPDATE, or IN context. */
function expand(helper: SQLHelper, prefix: string, values: unknown[]): string {
	const context = command(prefix);
	const { columns, value: rows } = helper;
	if (!['insert', 'update', 'set', 'in'].includes(context)) {
		throw new SyntaxError(
			'Helpers are only allowed for INSERT, UPDATE and IN commands',
		);
	}

	if (columns.length === 0 && context === 'insert') {
		throw new SyntaxError('Cannot INSERT with no columns');
	}

	if (context === 'in') {
		if (columns.length > 1) {
			throw new SyntaxError('Cannot use WHERE IN helper with multiple columns');
		}

		if (rows.length === 0) {
			return '(NULL) ';
		}

		return (
			'('
			+ rows
				.map((row) => {
					if (columns.length > 0 && row === null) {
						throw new SyntaxError(
							'Cannot use null as an item in WHERE IN helper with a column',
						);
					}

					return bind(
						columns.length > 0 ? row?.[columns[0]!] : row,
						values,
						'',
					);
				})
				.join(', ')
			+ ') '
		);
	}

	if (context === 'insert') {
		if (rows.some((row) => row === null || row === undefined)) {
			throw new SyntaxError(
				'Cannot use null or undefined as an item in INSERT helper',
			);
		}

		const selected = columns.filter((key) =>
			rows.some((row) => row[key] !== undefined),
		);
		if (selected.length === 0) {
			throw new SyntaxError(
				'Insert needs to have at least one column with a defined value',
			);
		}

		return (
			'('
			+ selected.map((column) => identifier(column)).join(', ')
			+ ') VALUES'
			+ rows
				.map(
					(row) =>
						'('
						+ selected.map((key) => bind(row[key], values, '')).join(', ')
						+ ')',
				)
				.join(',')
			+ ' '
		);
	}

	if (rows.length > 1) {
		throw new SyntaxError('Cannot use array of objects for UPDATE');
	}

	const row = rows[0];
	if (row === null || row === undefined) {
		throw new SyntaxError(
			'Cannot use null or undefined as an item in UPDATE helper',
		);
	}

	const selected = columns.filter((key) => row[key] !== undefined);
	if (selected.length === 0) {
		throw new SyntaxError('Update needs to have at least one column');
	}

	const set =
		context === 'update'
		&& !prefix.trimEnd().endsWith('ON DUPLICATE KEY UPDATE')
			? ' SET '
			: '';
	return (
		set
		+ selected
			.map((key) => `${identifier(key)} = ${bind(row[key], values, '')}`)
			.join(', ')
		+ ' '
	);
}

/** Flatten template fragments and collect bound parameter values. */
export function compile(
	strings: TemplateStringsArray,
	inputs: unknown[],
): Compiled {
	let text = '';
	const values: unknown[] = [];
	for (const [i, string_] of strings.entries()) {
		text += string_;
		if (i >= inputs.length) {
			continue;
		}

		const value = inputs[i];
		if (value !== null && typeof value === 'object' && fragment in value) {
			const nested = (value as { [fragment]: Fragment })[fragment].compile();
			text += nested.text;
			values.push(...nested.values);
		} else if (value instanceof SQLHelper) {
			text += expand(value, text, values);
		} else {
			text += bind(value, values, text) + ' ';
		}
	}

	return { text, values };
}
