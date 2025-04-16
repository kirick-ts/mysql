/**
 * Escapes an identifier.
 * @param name - Identifier name.
 * @returns -
 */
declare function id(name: string): Sql;
/**
 * @param row -
 * @returns -
 */
declare function insert(row: Record<string, unknown>): Sql;
/**
 * @param rows -
 * @returns -
 */
declare function insert(rows: Record<string, unknown>[]): Sql;
/**
 * @param row -
 * @returns -
 */
declare function set(row: Record<string, unknown>): Sql;
export type Sql = {
    sql: string;
    values: unknown[];
};
type SqlExtension = {
    id: typeof id;
    insert: typeof insert;
    set: typeof set;
};
/**
 * Creates SQL Query object from template string tag.
 * @param query -
 * @param values -
 * @returns -
 */
declare function createSql(query: TemplateStringsArray, ...values: unknown[]): Sql;
export declare const sql: typeof createSql & SqlExtension;
export {};
