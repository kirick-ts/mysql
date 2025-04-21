import mysql2 from 'mysql2/promise';
import { SqlExtension } from './sql.js';
export type MysqlClient = {
    sql: (<T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>) & SqlExtension;
};
/**
 * Creates a new mysql client. Connects to the server automatically.
 * @param config - Client configuration.
 * @returns - Mysql client.
 */
export declare function mysql(config: mysql2.PoolOptions): MysqlClient;
