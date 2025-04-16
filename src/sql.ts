import * as sqlTemplateTag from 'sql-template-tag';

/**
 * @param value -
 * @returns -
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Escapes an identifier.
 * @param name - Identifier name.
 * @returns -
 */
function id(name: string): Sql {
	return new sqlTemplateTag.Sql(
		[ '', '?' ],
		[ name ],
	);
}

/**
 * @param row -
 * @returns -
 */
function insert(row: Record<string, unknown>): Sql;
/**
 * @param rows -
 * @returns -
 */
function insert(rows: Record<string, unknown>[]): Sql;
// eslint-disable-next-line jsdoc/require-jsdoc
function insert(arg0: Record<string, unknown> | Record<string, unknown>[]): Sql {
	if (isPlainObject(arg0)) {
		return insert([ arg0 ]);
	}

	const rows_keys = Object.keys(arg0[0]);
	const rows_values: unknown[][] = [];
	for (const [ index, row ] of arg0.entries()) {
		for (const key of Object.keys(row)) {
			if (!rows_keys.includes(key)) {
				throw new Error(`Unexpected key "${key}" in row ${index}.`);
			}
		}

		rows_values.push(Object.values(row));
	}

	const keys_sql = new sqlTemplateTag.Sql(
		[
			'(?',
			...Array.from({ length: rows_keys.length - 1 }).fill(',?') as string[],
			')',
		],
		rows_keys,
	);

	return sqlTemplateTag.default`${keys_sql} VALUES ${sqlTemplateTag.bulk(rows_values)}`;
}

/**
 * @param row -
 * @returns -
 */
function set(row: Record<string, unknown>): Sql {
	const row_entries = Object.entries(row);
	const values: unknown[] = [];
	for (const [ key, value ] of row_entries) {
		values.push(
			key,
			value,
		);
	}

	const sql_parts = [];
	for (let index = 0; index < row_entries.length; index++) {
		sql_parts.push(
			`${index > 0 ? ',' : ''}?`,
			'=',
		);
	}

	sql_parts.push('');

	return new sqlTemplateTag.Sql(
		sql_parts,
		values,
	);
}

export type Sql = {
	sql: string,
	values: unknown[],
};

type SqlExtension = {
	id: typeof id,
	insert: typeof insert,
	set: typeof set,
};

/**
 * Creates SQL Query object from template string tag.
 * @param query -
 * @param values -
 * @returns -
 */
function createSql(query: TemplateStringsArray, ...values: unknown[]): Sql {
	const sql_query = new sqlTemplateTag.Sql(query, values);

	return {
		sql: sql_query.sql,
		values: sql_query.values,
	};
}

export const sql = Object.defineProperties(
	createSql,
	{
		id: {
			configurable: false,
			enumerable: false,
			writable: false,
			value: id,
		},
		insert: {
			configurable: false,
			enumerable: false,
			writable: false,
			value: insert,
		},
		set: {
			configurable: false,
			enumerable: false,
			writable: false,
			value: set,
		},
	},
) as typeof createSql & SqlExtension;
