import type { SQL as BunSQL } from 'bun';
import type { QueryError } from 'mysql2';

export class SQLError extends Error {
	override name = 'SQLError';
}

export class MySQLError extends SQLError implements BunSQL.MySQLError {
	override name = 'MySQLError';
	readonly code: string;
	readonly errno?: number;
	readonly sqlState?: string;

	constructor(
		message: string,
		options: { code: string; errno?: number; sqlState?: string },
	) {
		super(message);
		this.code = options.code;
		this.errno = options.errno;
		this.sqlState = options.sqlState;
	}
}

/** Create an error with a Bun-compatible MySQL client code. */
export function clientError(code: string, message: string): MySQLError {
	return new MySQLError(message, { code: `ERR_MYSQL_${code}` });
}

/** Translate driver errors into the Bun SQL error hierarchy. */
export function databaseError(error: unknown): unknown {
	if (
		!(error instanceof Error)
		|| error instanceof SQLError
		|| error instanceof SyntaxError
	) {
		return error;
	}

	const db = error as Partial<QueryError> & Error & { sqlMessage?: string };
	if (db.code?.startsWith('ERR_MYSQL_')) {
		return error;
	}

	let code = 'SERVER_ERROR';
	if (db.errno === 1064) {
		code = 'SYNTAX_ERROR';
	} else {
		switch (db.code) {
			case 'ECONNREFUSED':
				code = 'CONNECTION_REFUSED';
				break;

			case 'ETIMEDOUT':
				code = 'CONNECTION_TIMEOUT';
				break;

			case 'PROTOCOL_CONNECTION_LOST':
				code = 'CONNECTION_CLOSED';
				break;

			default:
				break;
		}
	}

	return new MySQLError(db.sqlMessage ?? db.message, {
		code: `ERR_MYSQL_${code}`,
		errno: db.errno,
		sqlState: db.sqlState,
	});
}
