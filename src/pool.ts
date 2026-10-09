import type { SQL as BunSQL } from 'bun';
import mysql2, { type FieldPacket } from 'mysql2';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { clientError, databaseError } from './errors.js';
import { poolOptions } from './options.js';
import { bindParameters } from './parameters.js';
import type { Query } from './query.js';
import { result, typeCast } from './results.js';

export class ClientPool {
	#initialized = new WeakSet<object>();
	#connections = new Set<PoolConnection>();
	#pending = new Set<Promise<unknown>>();
	#pool: Pool | undefined;
	#opening: Promise<Pool> | undefined;
	#isClosed = false;
	#closing: Promise<void> | undefined;

	constructor(readonly options: BunSQL.PostgresOrMySQLOptions) {
		if (
			options.max !== undefined
			&& (!Number.isSafeInteger(options.max) || options.max <= 0)
		) {
			throw new RangeError('max must be a positive integer');
		}
	}

	/** Resolve credentials once when the pool is first needed. */
	#getPool(): Promise<Pool> {
		return (this.#opening ??= (async () => {
			const password = this.options.password ?? this.options.pass;
			const resolved =
				typeof password === 'function' ? await password() : password;
			this.#pool = mysql2
				.createPool(poolOptions({ ...this.options, password: resolved }))
				.promise();
			return this.#pool;
		})());
	}

	/** Acquire and initialize a connection, cleaning up failed initialization. */
	async #acquire(): Promise<PoolConnection> {
		const activePool = await this.#getPool();
		const connection = await activePool.getConnection();
		this.#connections.add(connection);
		try {
			if (!this.#initialized.has(connection.connection)) {
				await connection.query("SET time_zone = '+00:00'");
				this.#initialized.add(connection.connection);
				this.options.onconnect?.(null);
			}

			return connection;
		} catch (error) {
			this.#connections.delete(connection);
			connection.destroy();
			throw error;
		}
	}

	/** Execute a query once and release its exclusive connection. */
	async run<T>(query: Query<T>): Promise<T> {
		if (this.#isClosed) {
			throw clientError('CONNECTION_CLOSED', 'Connection closed');
		}

		const task = (async () => {
			let connection: PoolConnection | undefined;
			let restoreWriter: (() => void) | undefined;
			try {
				const compiled = query.compile();
				if (query.isSimple && compiled.values.length > 0) {
					throw new Error('Cannot use parameters with simple query');
				}

				connection = await this.#acquire();
				if (query.cancelled) {
					throw clientError('QUERY_CANCELLED', 'Query cancelled');
				}

				query.onCancel = () => connection!.destroy();
				const request = {
					sql: compiled.text,
					rowsAsArray: true,
					typeCast: typeCast(query.mode, query.isSimple),
				};
				if (!query.isSimple) {
					restoreWriter = bindParameters(connection, request, compiled.values);
				}

				const [rows, fields] = query.isSimple
					? await connection.query(request)
					: await connection.execute(request, compiled.values);
				const resultOptions = {
					mode: query.mode,
					shouldUseBigInt: this.options.bigint === true,
					isSimple: query.isSimple,
				};
				if (
					Array.isArray(fields)
					&& fields.some((field) => !field || Array.isArray(field))
				) {
					return (rows as unknown[]).map((r, i) =>
						result(r, fields[i] as unknown as FieldPacket[], resultOptions),
					) as T;
				}

				return result(rows, fields, resultOptions) as T;
			} catch (error) {
				throw databaseError(error);
			} finally {
				restoreWriter?.();

				query.onCancel = undefined;
				if (connection) {
					this.#connections.delete(connection);
					connection.release();
				}
			}
		})();
		this.#pending.add(task);
		try {
			return await task;
		} finally {
			this.#pending.delete(task);
		}
	}

	/** Drain started queries before closing the pool. */
	close(config?: { timeout?: number }): Promise<void> {
		return (this.#closing ??= (async () => {
			this.#isClosed = true;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const drain = Promise.allSettled(this.#pending);
			if (config?.timeout === undefined) {
				await drain;
			} else {
				await Promise.race([
					drain,
					new Promise<void>((resolve) => {
						timer = setTimeout(() => {
							for (const conn of this.#connections) {
								conn.destroy();
							}

							resolve();
						}, config.timeout! * 1000);
					}),
				]);
				clearTimeout(timer);
			}

			if (this.#opening) {
				await this.#opening;
			}

			await this.#pool?.end();
			this.options.onclose?.(null);
		})());
	}

	async connect(): Promise<void> {
		if (this.#isClosed) {
			throw clientError('CONNECTION_CLOSED', 'Connection closed');
		}

		const connection = await this.#acquire();
		this.#connections.delete(connection);
		connection.release();
	}
}
