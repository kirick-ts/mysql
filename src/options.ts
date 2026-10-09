import type { SQL as BunSQL } from 'bun';
import mysql2, { type AuthPlugin, type PoolOptions } from 'mysql2';
import { clientError } from './errors.js';

/** Resolve explicit options without consulting the environment. */
export function optionsFrom(
	input: string | URL | BunSQL.PostgresOrMySQLOptions,
	overrides: BunSQL.PostgresOrMySQLOptions,
): BunSQL.PostgresOrMySQLOptions {
	if (!input) {
		throw new TypeError('SQL requires an explicit connection URL or options');
	}

	const options =
		typeof input === 'string' || input instanceof URL
			? { url: input, ...overrides }
			: { ...input, ...overrides };
	if (
		options.adapter
		&& options.adapter !== 'mysql'
		&& options.adapter !== 'mariadb'
	) {
		throw new TypeError('Only MySQL and MariaDB are supported');
	}

	if (options.url) {
		const url = new URL(options.url);
		if (!['mysql:', 'mysql2:', 'mariadb:'].includes(url.protocol)) {
			throw new TypeError('Only MySQL and MariaDB URLs are supported');
		}

		return {
			hostname: url.hostname || 'localhost',
			port: url.port ? Number(url.port) : 3306,
			username: decodeURIComponent(url.username),
			password: decodeURIComponent(url.password),
			database: decodeURIComponent(url.pathname.slice(1)),
			path: url.searchParams.get('socket') ?? undefined,
			tls: url.searchParams.get('ssl') === 'true' ? true : undefined,
			...options,
			adapter: options.adapter ?? 'mysql',
		};
	}

	return { ...options, adapter: options.adapter ?? 'mysql' };
}

/** Enforce Bun's opt-in for server public-key retrieval. */
function authPlugin(plugin: AuthPlugin, isAllowed: boolean): AuthPlugin {
	return (metadata) => {
		const authenticate = plugin(metadata);
		return (data) => {
			const response = authenticate(data);
			if (
				!isAllowed
				&& Buffer.isBuffer(response)
				&& response.length === 1
				&& (response[0] === 1 || response[0] === 2)
			) {
				throw clientError(
					'PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED',
					'Server public key retrieval is not allowed; use TLS or allowPublicKeyRetrieval',
				);
			}

			return response;
		};
	};
}

/** Translate Bun connection options into mysql2 settings. */
export function poolOptions(
	options: BunSQL.PostgresOrMySQLOptions,
): PoolOptions {
	return {
		host: options.hostname ?? options.host ?? 'localhost',
		port: Number(options.port ?? 3306),
		user: options.username ?? options.user ?? 'root',
		password:
			typeof options.password === 'string'
				? options.password
				: typeof options.pass === 'string'
					? options.pass
					: '',
		database: options.database ?? options.db ?? 'mysql',
		socketPath: options.path,
		connectionLimit: options.max ?? 10,
		maxIdle: options.max ?? 10,
		idleTimeout: (options.idleTimeout ?? options.idle_timeout ?? 0) * 1000,
		connectTimeout:
			(options.connectionTimeout
				?? options.connection_timeout
				?? options.connectTimeout
				?? options.connect_timeout
				?? 30) * 1000,
		disableEval: true,
		charset: 'utf8mb4',
		timezone: 'Z',
		supportBigNumbers: true,
		bigNumberStrings: true,
		flags: ['-FOUND_ROWS'],
		ssl: tlsOptions(options),
		multipleStatements: true,
		authPlugins: {
			caching_sha2_password: authPlugin(
				mysql2.authPlugins.caching_sha2_password(),
				options.allowPublicKeyRetrieval === true,
			),
			sha256_password: authPlugin(
				mysql2.authPlugins.sha256_password(),
				options.allowPublicKeyRetrieval === true,
			),
		},
	};
}

/** Resolve the TLS settings independently from connection aliases. */
function tlsOptions(
	options: BunSQL.PostgresOrMySQLOptions,
): PoolOptions['ssl'] {
	const tls = options.tls ?? options.ssl;
	let ssl: PoolOptions['ssl'];
	if (tls && tls !== 'disable') {
		if (typeof tls === 'object') {
			if ('text' in tls) {
				throw new TypeError(
					'BunFile TLS options are unavailable outside Bun; pass certificate contents',
				);
			}

			ssl = tls as PoolOptions['ssl'];
		} else {
			ssl = {
				rejectUnauthorized: !['require', 'prefer', 'allow'].includes(
					String(tls),
				),
			};
		}
	}

	return ssl;
}
