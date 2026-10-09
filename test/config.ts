/** Validate and select the implementation used by every shared test. */
export function provider(): 'bun' | 'mysql' {
	// oxlint-disable-next-line node/no-process-env -- Tests explicitly select a provider and disposable database.
	const value = process.env.SQL_CLIENT ?? 'mysql';
	if (value !== 'bun' && value !== 'mysql') {
		throw new Error('SQL_CLIENT must be bun or mysql');
	}

	return value;
}

/** Require an explicit disposable database for integration tests. */
export function databaseURL(): string {
	// oxlint-disable-next-line node/no-process-env -- Tests explicitly select a provider and disposable database.
	const url = process.env.SQL_TEST_URL;
	if (!url) {
		throw new Error(
			'SQL_TEST_URL must point to a disposable test database (or run bun test:docker)',
		);
	}

	return url;
}

export const options = { allowPublicKeyRetrieval: true, max: 3 };

/** Describe the expected metadata on a Bun MySQL result array. */
export function metadata(
	count: number,
	lastInsertRowid = 0,
	affectedRows = 0,
): {
	count: number;
	command: null;
	lastInsertRowid: number;
	affectedRows: number;
} {
	return { count, command: null, lastInsertRowid, affectedRows };
}
