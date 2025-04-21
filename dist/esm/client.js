import mysql2 from 'mysql2/promise';
import { extendSql, sql, } from './sql.js';
/**
 * Creates a new mysql client. Connects to the server automatically.
 * @param config - Client configuration.
 * @returns - Mysql client.
 */
export function mysql(config) {
    const raw_client = mysql2.createPool(config);
    // eslint-disable-next-line jsdoc/require-jsdoc
    async function createSql(query, ...values) {
        const [result] = await raw_client.query(sql(query, ...values));
        return result;
    }
    return {
        // client: raw_client,
        // get config() {
        // 	return raw_client.pool.config.connectionConfig;
        // },
        sql: extendSql(createSql),
    };
}
