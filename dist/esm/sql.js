import * as sqlTemplateTag from 'sql-template-tag';
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
    return new sqlTemplateTag.Sql(['', '?'], [name]);
}
// eslint-disable-next-line jsdoc/require-jsdoc
function insert(arg0) {
    if (isPlainObject(arg0)) {
        return insert([arg0]);
    }
    const rows_keys = Object.keys(arg0[0]);
    const rows_values = [];
    for (const [index, row] of arg0.entries()) {
        for (const key of Object.keys(row)) {
            if (!rows_keys.includes(key)) {
                throw new Error(`Unexpected key "${key}" in row ${index}.`);
            }
        }
        rows_values.push(Object.values(row));
    }
    const keys_sql = new sqlTemplateTag.Sql([
        '(?',
        ...Array.from({ length: rows_keys.length - 1 }).fill(',?'),
        ')',
    ], rows_keys);
    return sqlTemplateTag.default `${keys_sql} VALUES ${sqlTemplateTag.bulk(rows_values)}`;
}
/**
 * @param row -
 * @returns -
 */
function set(row) {
    const row_entries = Object.entries(row);
    const values = [];
    for (const [key, value] of row_entries) {
        values.push(key, value);
    }
    const sql_parts = [];
    for (let index = 0; index < row_entries.length; index++) {
        sql_parts.push(`${index > 0 ? ',' : ''}?`, '=');
    }
    sql_parts.push('');
    return new sqlTemplateTag.Sql(sql_parts, values);
}
/**
 * Creates SQL Query object from template string tag.
 * @param query -
 * @param values -
 * @returns -
 */
function createSql(query, ...values) {
    const sql_query = new sqlTemplateTag.Sql(query, values);
    return {
        sql: sql_query.sql,
        values: sql_query.values,
    };
}
export const sql = Object.defineProperties(createSql, {
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
