import mysql2 from 'mysql2/promise';
import {
	extendSql,
	sql,
	SqlExtension,
} from './sql.js';

// declare function createSql<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;

export type MysqlClient = {
	// readonly client: mysql2.Pool,
	// readonly config: mysql2.ConnectionOptions,
	sql: (<T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>) & SqlExtension,
};

/**
 * Creates a new mysql client. Connects to the server automatically.
 * @param config - Client configuration.
 * @returns - Mysql client.
 */
export function mysql(config: mysql2.PoolOptions): MysqlClient {
	const raw_client = mysql2.createPool(config);

	// eslint-disable-next-line jsdoc/require-jsdoc
	async function createSql<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
		const [ result ] = await raw_client.query(
			sql(query, ...values),
		);
		return result as T;
	}

	return {
		// client: raw_client,
		// get config() {
		// 	return raw_client.pool.config.connectionConfig;
		// },
		sql: extendSql(createSql),
	} satisfies MysqlClient;
}
