/* oxlint-disable no-await-in-loop -- Database startup, polling, provider runs, and cleanup share resources and must run sequentially. */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import mysql, { type ConnectionOptions } from 'mysql2/promise';

// Bun's SQL parser can consult these even when given a URL. Never let a local
// dotenv file or inherited application settings select a real database.
const environment = Object.fromEntries(
	// oxlint-disable-next-line node/no-process-env -- Test configuration is explicitly supplied by the caller.
	Object.entries(process.env).filter(
		([key]) =>
			!/^(?:MYSQL|MARIADB|PG|POSTGRES|TLS_.*DATABASE_URL$|DATABASE_?URL$|PASSWORD$)/u.test(
				key,
			),
	),
);

const created = new Set<string>();
let isFailed = false;

/** Run a subprocess with an isolated environment and propagate failures. */
function run(
	command: string,
	args: string[],
	env = environment,
	shouldCapture = false,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env,
			stdio: shouldCapture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		});
		let output = '';
		let error = '';
		child.stdout?.on('data', (data) => {
			output += String(data);
		});
		child.stderr?.on('data', (data) => {
			error += String(data);
		});
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) {
				resolve(output.trim());
			} else {
				reject(new Error(`${command} ${args[0]} exited ${code}\n${error}`));
			}
		});
	});
}

/** Remove only containers created by this test run. */
async function cleanup(): Promise<void> {
	for (const name of created) {
		try {
			await run(
				'docker',
				['rm', '--force', '--volumes', name],
				environment,
				true,
			);
			created.delete(name);
		} catch (error) {
			// oxlint-disable-next-line no-console -- Report test progress or failures to the invoking terminal.
			console.error(`Failed to remove test container ${name}`, error);
			isFailed = true;
		}
	}
}

/** Poll a disposable database until connections and queries succeed. */
async function waitForDatabase(
	server: string,
	config: ConnectionOptions,
): Promise<void> {
	const deadline = Date.now() + 120000;
	while (true) {
		try {
			const connection = await mysql.createConnection(config);
			const [version] = await connection.query('SELECT VERSION() AS version');
			// oxlint-disable-next-line no-console -- Report test progress or failures to the invoking terminal.
			console.log(version);
			await connection.end();
			break;
		} catch (error) {
			if (Date.now() >= deadline) {
				throw new Error(`Database ${server} was not ready in 120 seconds`, {
					cause: error,
				});
			}

			await new Promise((resolve) => {
				setTimeout(resolve, 500);
			});
		}
	}
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, async () => {
		try {
			await cleanup();
		} finally {
			process.exit(130);
		}
	});
}

try {
	const { bun } = process.versions;
	if (bun !== '1.4.2') {
		throw new Error(
			`Compatibility reference is Bun 1.4.2; found ${bun ?? 'no Bun runtime'}`,
		);
	}

	// Check Node's own loaders before Vitest's module transformation can mask
	// CommonJS/ESM interoperability errors in the published entry points.
	for (const mode of ['module', 'commonjs']) {
		const load =
			mode === 'module'
				? "import { SQL } from '@kirick/mysql';"
				: "const { SQL } = require('@kirick/mysql');";
		await run('node', [
			'--input-type',
			mode,
			'--eval',
			`${load}
			const sql = new SQL('mysql://root@127.0.0.1/unused');
			if (typeof sql !== 'function') throw new Error('SQL must be callable');
			sql.close().catch(error => { console.error(error); process.exitCode = 1; });
		`,
		]);
	}

	for (const [server, image] of [
		// oxlint-disable-next-line node/no-process-env -- Test configuration is explicitly supplied by the caller.
		['mysql', process.env.SQL_TEST_MYSQL_IMAGE ?? 'mysql:8.4.7'],
		// oxlint-disable-next-line node/no-process-env -- Test configuration is explicitly supplied by the caller.
		['mariadb', process.env.SQL_TEST_MARIADB_IMAGE ?? 'mariadb:10.11.13'],
	] as const) {
		const name = `kirick-mysql-test-${server}-${randomUUID().slice(0, 8)}`;
		// Bun 1.4.2 fails caching_sha2_password authentication with long passwords.
		const password = randomUUID().replaceAll('-', '').slice(0, 16);
		created.add(name);
		// oxlint-disable-next-line no-console -- Report test progress or failures to the invoking terminal.
		console.log(`\nStarting disposable ${image}`);
		await run(
			'docker',
			[
				'run',
				'--detach',
				'--rm',
				'--name',
				name,
				'--publish',
				'127.0.0.1::3306',
				'--env',
				`MYSQL_ROOT_PASSWORD=${password}`,
				'--env',
				'MYSQL_DATABASE=compat',
				'--tmpfs',
				'/var/lib/mysql',
				image,
			],
			environment,
			true,
		);
		const mapping = await run(
			'docker',
			['port', name, '3306/tcp'],
			environment,
			true,
		);
		const port = Number(mapping.split(':').at(-1));
		const url = `mysql://root:${password}@127.0.0.1:${port}/compat`;
		await waitForDatabase(server, {
			host: '127.0.0.1',
			port,
			user: 'root',
			password,
			database: 'compat',
			connectTimeout: 1000,
		});

		for (const provider of ['bun', 'mysql']) {
			// oxlint-disable-next-line no-console -- Report test progress or failures to the invoking terminal.
			console.log(`\n${server}: ${provider}, Bun ${bun}`);
			try {
				await run(process.execPath, ['--no-env-file', 'test', 'src'], {
					...environment,
					SQL_CLIENT: provider,
					SQL_TEST_URL: url,
					TZ: 'Pacific/Honolulu',
				});
			} catch (error) {
				// oxlint-disable-next-line no-console -- Report test progress or failures to the invoking terminal.
				console.error(error);
				isFailed = true;
			}
		}

		// oxlint-disable-next-line no-console -- Report test progress or failures to the invoking terminal.
		console.log(
			`\n${server}: mysql, Node ${await run('node', ['--version'], environment, true)}`,
		);
		try {
			await run(
				'node',
				['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism'],
				{
					...environment,
					SQL_CLIENT: 'mysql',
					SQL_TEST_URL: url,
					TZ: 'Pacific/Honolulu',
				},
			);
		} catch (error) {
			// oxlint-disable-next-line no-console -- Report test progress or failures to the invoking terminal.
			console.error(error);
			isFailed = true;
		}

		await run(
			'docker',
			['rm', '--force', '--volumes', name],
			environment,
			true,
		);
		created.delete(name);
	}
} finally {
	await cleanup();
}

if (isFailed) {
	process.exitCode = 1;
}
