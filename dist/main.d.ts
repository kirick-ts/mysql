import mysql2 from "mysql2/promise";
import { ProcedureCallPacket, ResultSetHeader } from "mysql2";

//#region src/client.d.ts
type MysqlClient = {
  sql<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

/**
* Creates a new mysql client. Connects to the server automatically.
* @param config - Client configuration.
* @returns - Mysql client.
*/
declare function mysql(config: mysql2.PoolOptions): MysqlClient;

//#endregion
//#region src/sql.d.ts
declare class Sql {
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
type SqlExtension = {
  empty: Sql;
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
declare const sql: typeof createSql & SqlExtension;

//#endregion
export { MysqlClient, ProcedureCallPacket, ResultSetHeader, Sql, mysql, sql };