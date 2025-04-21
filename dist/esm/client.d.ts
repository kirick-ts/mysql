import mysql2 from 'mysql2/promise';
export type MysqlClient = {
    sql<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};
/**
 * Creates a new mysql client. Connects to the server automatically.
 * @param config - Client configuration.
 * @returns - Mysql client.
 */
export declare function mysql(config: mysql2.PoolOptions): MysqlClient;
