export declare class Sql {
    readonly sql: string;
    readonly values: unknown[];
    constructor(sql: string, values: unknown[]);
}
declare class SqlIdentifier {
    readonly id: string;
    constructor(id: string);
}
/**
 * Escapes an identifier.
 * @param name - Identifier name.
 * @returns -
 */
declare function id(name: string): SqlIdentifier;
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
declare function set(row: Record<string, unknown>): Sql[];
export type SqlExtension = {
    empty: Sql;
    id: typeof id;
    insert: typeof insert;
    set: typeof set;
};
/**
 * Extends a value with SQL extension methods.
 * @param value -
 * @returns -
 */
export declare function extendSql<const T>(value: T): T & SqlExtension;
/**
 * Creates SQL Query object from template string tag.
 * @param query -
 * @param values -
 * @returns -
 */
declare function createSql(query: TemplateStringsArray, ...values: unknown[]): Sql;
export declare const sql: typeof createSql & SqlExtension;
export {};
