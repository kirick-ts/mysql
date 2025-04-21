export class Sql {
    sql;
    values;
    // eslint-disable-next-line no-useless-constructor
    constructor(sql, values) {
        this.sql = sql;
        this.values = values;
        // do nothing
    }
}
class SqlIdentifier {
    id;
    // eslint-disable-next-line no-useless-constructor
    constructor(
    // eslint-disable-next-line no-shadow
    id) {
        this.id = id;
        // do nothing
    }
}
/**
 * @param value -
 * @returns -
 */
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Escapes an identifier.
 * @param name - Identifier name.
 * @returns -
 */
function id(name) {
    return new SqlIdentifier(name);
}
// eslint-disable-next-line jsdoc/require-jsdoc
function insert(arg0) {
    if (isPlainObject(arg0)) {
        return insert([arg0]);
    }
    const rows_keys = [];
    const rows_values = [];
    for (const row of structuredClone(arg0)) {
        const row_values = [];
        for (const key of rows_keys) {
            row_values.push(row[key] ?? null);
            delete row[key];
        }
        // add new keys
        for (const [key, value] of Object.entries(row)) {
            rows_keys.push(key);
            row_values.push(value);
            for (const prev_row_values of rows_values) {
                prev_row_values.push(null);
            }
        }
        rows_values.push(row_values);
    }
    const ids = rows_keys.map((name) => new SqlIdentifier(name));
    return createSql `(${ids}) VALUES ${rows_values}`;
}
/**
 * @param row -
 * @returns -
 */
function set(row) {
    const sqls = [];
    for (const [key, value] of Object.entries(row)) {
        sqls.push(createSql `${new SqlIdentifier(key)}=${value}`);
    }
    return sqls;
}
/**
 * Converts a value to a SQL string representation.
 * @param value -
 * @param depth -
 * @returns -
 */
function toSql(value, depth = 0) {
    if (Array.isArray(value) || value instanceof Set) {
        const result_sql_parts = [];
        const result_values = [];
        for (const item of value) {
            const sql_nested = toSql(item, depth + 1);
            result_sql_parts.push(sql_nested.sql);
            result_values.push(...sql_nested.values);
        }
        return new Sql((depth > 0 ? '(' : '') + result_sql_parts.join(',') + (depth > 0 ? ')' : ''), result_values);
    }
    if (value instanceof Sql) {
        return value;
    }
    if (value instanceof SqlIdentifier) {
        return new Sql('??', [value.id]);
    }
    return new Sql('?', [value]);
}
/**
 * Creates SQL Query object from template string tag.
 * @param query -
 * @param values -
 * @returns -
 */
function createSql(query, ...values) {
    const result_sql_parts = [query[0]];
    const result_values = [];
    for (const [index, value] of values.entries()) {
        const sql_nested = toSql(value);
        result_sql_parts.push(sql_nested.sql);
        result_values.push(...sql_nested.values);
        result_sql_parts.push(query[index + 1]);
    }
    return new Sql(result_sql_parts.join(''), result_values);
}
export const sql = Object.defineProperties(createSql, {
    empty: {
        configurable: false,
        enumerable: false,
        writable: false,
        value: createSql ``,
    },
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
});
