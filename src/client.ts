import mysql2 from 'mysql2/promise';
import { sql } from './sql.js';

export type MysqlClient = {
	// readonly client: mysql2.Pool,
	readonly config: mysql2.ConnectionOptions,
	sql<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>,
};

/**
 * Creates a new mysql client. Connects to the server automatically.
 * @param config - Client configuration.
 * @returns - Mysql client.
 */
export function mysql(config: mysql2.PoolOptions): MysqlClient {
	const raw_client = mysql2.createPool(config);

	return {
		// client: raw_client,
		get config() {
			return raw_client.config;
		},
		async sql<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
			const [ result ] = await raw_client.query(
				sql(query, ...values),
			);
			return result as T;
		},
	} satisfies MysqlClient;
}
