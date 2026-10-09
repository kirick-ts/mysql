import { readFile } from "node:fs/promises";
import mysql2 from "mysql2";
//#region src/errors.ts
var SQLError = class extends Error {
	name = "SQLError";
};
var MySQLError = class extends SQLError {
	name = "MySQLError";
	code;
	errno;
	sqlState;
	constructor(message, options) {
		super(message);
		this.code = options.code;
		this.errno = options.errno;
		this.sqlState = options.sqlState;
	}
};
/** Create an error with a Bun-compatible MySQL client code. */
function clientError(code, message) {
	return new MySQLError(message, { code: `ERR_MYSQL_${code}` });
}
/** Translate driver errors into the Bun SQL error hierarchy. */
function databaseError(error) {
	if (!(error instanceof Error) || error instanceof SQLError || error instanceof SyntaxError) return error;
	const db = error;
	if (db.code?.startsWith("ERR_MYSQL_")) return error;
	let code = "SERVER_ERROR";
	if (db.errno === 1064) code = "SYNTAX_ERROR";
	else switch (db.code) {
		case "ECONNREFUSED":
			code = "CONNECTION_REFUSED";
			break;
		case "ETIMEDOUT":
			code = "CONNECTION_TIMEOUT";
			break;
		case "PROTOCOL_CONNECTION_LOST": code = "CONNECTION_CLOSED";
	}
	return new MySQLError(db.sqlMessage ?? db.message, {
		code: `ERR_MYSQL_${code}`,
		errno: db.errno,
		sqlState: db.sqlState
	});
}
//#endregion
//#region src/options.ts
/** Resolve explicit options without consulting the environment. */
function optionsFrom(input, overrides) {
	if (!input) throw new TypeError("SQL requires an explicit connection URL or options");
	const options = typeof input === "string" || input instanceof URL ? {
		url: input,
		...overrides
	} : {
		...input,
		...overrides
	};
	if (options.adapter && options.adapter !== "mysql" && options.adapter !== "mariadb") throw new TypeError("Only MySQL and MariaDB are supported");
	if (options.url) {
		const url = new URL(options.url);
		if (![
			"mysql:",
			"mysql2:",
			"mariadb:"
		].includes(url.protocol)) throw new TypeError("Only MySQL and MariaDB URLs are supported");
		return {
			hostname: url.hostname || "localhost",
			port: url.port ? Number(url.port) : 3306,
			username: decodeURIComponent(url.username),
			password: decodeURIComponent(url.password),
			database: decodeURIComponent(url.pathname.slice(1)),
			path: url.searchParams.get("socket") ?? void 0,
			tls: url.searchParams.get("ssl") === "true" ? true : void 0,
			...options,
			adapter: options.adapter ?? "mysql"
		};
	}
	return {
		...options,
		adapter: options.adapter ?? "mysql"
	};
}
/** Enforce Bun's opt-in for server public-key retrieval. */
function authPlugin(plugin, isAllowed) {
	return (metadata) => {
		const authenticate = plugin(metadata);
		return (data) => {
			const response = authenticate(data);
			if (!isAllowed && Buffer.isBuffer(response) && response.length === 1 && (response[0] === 1 || response[0] === 2)) throw clientError("PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED", "Server public key retrieval is not allowed; use TLS or allowPublicKeyRetrieval");
			return response;
		};
	};
}
/** Translate Bun connection options into mysql2 settings. */
function poolOptions(options) {
	return {
		host: options.hostname ?? options.host ?? "localhost",
		port: Number(options.port ?? 3306),
		user: options.username ?? options.user ?? "root",
		password: typeof options.password === "string" ? options.password : typeof options.pass === "string" ? options.pass : "",
		database: options.database ?? options.db ?? "mysql",
		socketPath: options.path,
		connectionLimit: options.max ?? 10,
		maxIdle: options.max ?? 10,
		idleTimeout: (options.idleTimeout ?? options.idle_timeout ?? 0) * 1e3,
		connectTimeout: (options.connectionTimeout ?? options.connection_timeout ?? options.connectTimeout ?? options.connect_timeout ?? 30) * 1e3,
		disableEval: true,
		charset: "utf8mb4",
		timezone: "Z",
		supportBigNumbers: true,
		bigNumberStrings: true,
		flags: ["-FOUND_ROWS"],
		ssl: tlsOptions(options),
		multipleStatements: true,
		authPlugins: {
			caching_sha2_password: authPlugin(mysql2.authPlugins.caching_sha2_password(), options.allowPublicKeyRetrieval === true),
			sha256_password: authPlugin(mysql2.authPlugins.sha256_password(), options.allowPublicKeyRetrieval === true)
		}
	};
}
/** Resolve the TLS settings independently from connection aliases. */
function tlsOptions(options) {
	const tls = options.tls ?? options.ssl;
	let ssl;
	if (tls && tls !== "disable") {
		if (typeof tls === "object") {
			if ("text" in tls) throw new TypeError("BunFile TLS options are unavailable outside Bun; pass certificate contents");
			ssl = tls;
		} else ssl = { rejectUnauthorized: ![
			"require",
			"prefer",
			"allow"
		].includes(String(tls)) };
	}
	return ssl;
}
//#endregion
//#region src/parameters.ts
/** Prefix bytes with a MySQL length-encoded integer. */
function lengthEncoded(bytes) {
	let prefix;
	if (bytes.length < 251) prefix = Buffer.from([bytes.length]);
	else if (bytes.length < 65536) {
		prefix = Buffer.alloc(3);
		prefix[0] = 252;
		prefix.writeUInt16LE(bytes.length, 1);
	} else if (bytes.length < 16777216) {
		prefix = Buffer.alloc(4);
		prefix[0] = 253;
		prefix.writeUIntLE(bytes.length, 1, 3);
	} else {
		prefix = Buffer.alloc(9);
		prefix[0] = 254;
		prefix.writeBigUInt64LE(BigInt(bytes.length), 1);
	}
	return Buffer.concat([prefix, bytes]);
}
/** Choose Bun's integer or double encoding for a JavaScript number. */
function encodeNumber(value) {
	if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
		if (value >= -2147483648 && value <= 4294967295) {
			const bytes = Buffer.alloc(4);
			const unsigned = value > 2147483647 ? 128 : 0;
			if (unsigned) bytes.writeUInt32LE(value);
			else bytes.writeInt32LE(value);
			return {
				type: 3,
				unsigned,
				bytes
			};
		}
		return encode(BigInt(value));
	}
	const bytes = Buffer.alloc(8);
	bytes.writeDoubleLE(value);
	return {
		type: 5,
		unsigned: 0,
		bytes
	};
}
/** Encode one bound value using Bun-compatible MySQL parameter types. */
function encode(value) {
	if (value === null || value === void 0) return {
		type: 6,
		unsigned: 0,
		bytes: Buffer.alloc(0)
	};
	if (typeof value === "boolean") return {
		type: 1,
		unsigned: 0,
		bytes: Buffer.from([Number(value)])
	};
	if (typeof value === "number") return encodeNumber(value);
	if (typeof value === "bigint") {
		const bytes = Buffer.alloc(8);
		const unsigned = value > 9223372036854775807n ? 128 : 0;
		if (unsigned) bytes.writeBigUInt64LE(value);
		else bytes.writeBigInt64LE(value);
		return {
			type: 8,
			unsigned,
			bytes
		};
	}
	if (value instanceof Date) {
		const bytes = Buffer.alloc(12);
		bytes[0] = 11;
		bytes.writeUInt16LE(value.getUTCFullYear(), 1);
		bytes[3] = value.getUTCMonth() + 1;
		bytes[4] = value.getUTCDate();
		bytes[5] = value.getUTCHours();
		bytes[6] = value.getUTCMinutes();
		bytes[7] = value.getUTCSeconds();
		bytes.writeUInt32LE(value.getUTCMilliseconds() * 1e3, 8);
		return {
			type: 12,
			unsigned: 0,
			bytes
		};
	}
	if (Buffer.isBuffer(value)) return {
		type: 253,
		unsigned: 0,
		bytes: lengthEncoded(value)
	};
	if (typeof value === "object") return {
		type: 245,
		unsigned: 0,
		bytes: lengthEncoded(Buffer.from(JSON.stringify(value)))
	};
	return {
		type: 253,
		unsigned: 0,
		bytes: lengthEncoded(Buffer.from(String(value)))
	};
}
const signatures = /* @__PURE__ */ new WeakMap();
/** Install a query-local packet adapter and return its cleanup callback. */
function bindParameters(connection, request, values) {
	const writer = connection.connection;
	const original = writer.writePacket;
	const parameters = values.map((value) => encode(value));
	let cache = signatures.get(connection.connection);
	if (!cache) {
		cache = /* @__PURE__ */ new Map();
		signatures.set(connection.connection, cache);
	}
	const signature = parameters.map((parameter) => `${parameter.type}:${parameter.unsigned}`).join(",");
	if (cache.get(request.sql) !== signature) {
		connection.unprepare(request);
		cache.set(request.sql, signature);
		if (cache.size > 1024) cache.delete(cache.keys().next().value);
	}
	writer.writePacket = function(packet) {
		if (parameters.length > 0 && packet.buffer[packet.start + 4] === 23) {
			const header = packet.buffer.subarray(packet.start, packet.start + 14);
			const bitmap = Buffer.alloc(Math.ceil(parameters.length / 8));
			const types = Buffer.alloc(parameters.length * 2);
			for (const [i, parameter] of parameters.entries()) {
				if (parameter.type === 6) bitmap[i >> 3] |= 1 << (i & 7);
				types[i * 2] = parameter.type;
				types[i * 2 + 1] = parameter.unsigned;
			}
			packet.buffer = Buffer.concat([
				header,
				bitmap,
				Buffer.from([1]),
				types,
				...parameters.map((parameter) => parameter.bytes)
			]);
			packet.start = 0;
			packet.end = packet.buffer.length;
			packet.offset = packet.end;
		}
		original.call(writer, packet);
	};
	return () => {
		writer.writePacket = original;
	};
}
//#endregion
//#region src/results.ts
const { Types } = mysql2;
var SQLResultArray = class extends Array {
	count = 0;
	command = null;
	lastInsertRowid = 0;
	affectedRows = 0;
	static get [Symbol.species]() {
		return Array;
	}
};
/** Preserve raw field bytes before mysql2 performs value conversion. */
function typeCast(mode, isSimple) {
	return (field, next) => {
		if (field.type === "GEOMETRY") return field.buffer();
		if (mode === "raw" && (isSimple || [
			"DECIMAL",
			"NEWDECIMAL",
			"JSON",
			"VARCHAR",
			"VAR_STRING",
			"STRING",
			"TINY_BLOB",
			"MEDIUM_BLOB",
			"LONG_BLOB",
			"BLOB",
			"ENUM",
			"SET"
		].includes(field.type))) return field.buffer();
		return next();
	};
}
/** Reconstruct the numeric bytes returned by Bun's raw result mode. */
function rawNumeric(value, type, isUnsigned) {
	const sizes = {
		[Types.TINY]: 1,
		[Types.SHORT]: 2,
		[Types.YEAR]: 2,
		[Types.LONG]: 4,
		[Types.INT24]: 3,
		[Types.LONGLONG]: 8,
		[Types.FLOAT]: 4,
		[Types.DOUBLE]: 8
	};
	const size = type === void 0 ? void 0 : sizes[type];
	if (size) {
		const buffer = Buffer.alloc(size);
		switch (type) {
			case Types.LONGLONG:
				if (isUnsigned) buffer.writeBigUInt64LE(BigInt(String(value)));
				else buffer.writeBigInt64LE(BigInt(String(value)));
				break;
			case Types.FLOAT:
				buffer.writeFloatLE(Number(value));
				break;
			case Types.DOUBLE:
				buffer.writeDoubleLE(Number(value));
				break;
			default: if (isUnsigned || type === Types.YEAR) buffer.writeUIntLE(Number(value), 0, size);
			else buffer.writeIntLE(Number(value), 0, size);
		}
		return buffer;
	}
}
/** Apply Bun value and raw-result decoding to a single field. */
function decode(value, field, { mode, shouldUseBigInt, isSimple }) {
	if (value === null) return null;
	const type = field.columnType;
	const isUnsigned = typeof field.flags === "number" && (field.flags & 32) !== 0;
	if (type === Types.BIT && field.columnLength === 1 && Buffer.isBuffer(value)) return value[0] !== 0;
	if (mode === "raw" && !isSimple) {
		const bytes = rawNumeric(value, type, isUnsigned);
		if (bytes !== void 0) return bytes;
	}
	if (type === Types.LONGLONG && !(mode === "raw" && isSimple)) {
		const integer = BigInt(String(value));
		if (integer >= (isUnsigned ? 0n : -2147483648n) && integer <= (isUnsigned ? 4294967295n : 2147483647n)) return Number(integer);
		return shouldUseBigInt ? integer : String(value);
	}
	if (type === Types.TIME && !isSimple && typeof value === "string") return value.split(".", 1)[0];
	return value;
}
/** Construct the public row array and its write-result metadata. */
function result(rows, fields, options) {
	const output = new SQLResultArray();
	if (!Array.isArray(rows)) {
		const header = rows;
		output.lastInsertRowid = header.insertId;
		output.affectedRows = header.affectedRows;
		return output;
	}
	for (const row of rows) {
		const values = row.map((value, i) => decode(value, fields[i], options));
		if (options.mode === "objects") output.push(Object.fromEntries(fields.map((field, i) => [field.name, values[i]])));
		else output.push(values);
	}
	output.count = output.length;
	return output;
}
//#endregion
//#region src/pool.ts
var ClientPool = class {
	options;
	#initialized = /* @__PURE__ */ new WeakSet();
	#connections = /* @__PURE__ */ new Set();
	#pending = /* @__PURE__ */ new Set();
	#pool;
	#opening;
	#isClosed = false;
	#closing;
	constructor(options) {
		this.options = options;
		if (options.max !== void 0 && (!Number.isSafeInteger(options.max) || options.max <= 0)) throw new RangeError("max must be a positive integer");
	}
	/** Resolve credentials once when the pool is first needed. */
	#getPool() {
		return this.#opening ??= (async () => {
			const password = this.options.password ?? this.options.pass;
			const resolved = typeof password === "function" ? await password() : password;
			this.#pool = mysql2.createPool(poolOptions({
				...this.options,
				password: resolved
			})).promise();
			return this.#pool;
		})();
	}
	/** Acquire and initialize a connection, cleaning up failed initialization. */
	async #acquire() {
		const connection = await (await this.#getPool()).getConnection();
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
	async run(query) {
		if (this.#isClosed) throw clientError("CONNECTION_CLOSED", "Connection closed");
		const task = (async () => {
			let connection;
			let restoreWriter;
			try {
				const compiled = query.compile();
				if (query.isSimple && compiled.values.length > 0) throw new Error("Cannot use parameters with simple query");
				connection = await this.#acquire();
				if (query.cancelled) throw clientError("QUERY_CANCELLED", "Query cancelled");
				query.onCancel = () => connection.destroy();
				const request = {
					sql: compiled.text,
					rowsAsArray: true,
					typeCast: typeCast(query.mode, query.isSimple)
				};
				if (!query.isSimple) restoreWriter = bindParameters(connection, request, compiled.values);
				const [rows, fields] = query.isSimple ? await connection.query(request) : await connection.execute(request, compiled.values);
				const resultOptions = {
					mode: query.mode,
					shouldUseBigInt: this.options.bigint === true,
					isSimple: query.isSimple
				};
				if (Array.isArray(fields) && fields.some((field) => !field || Array.isArray(field))) return rows.map((r, i) => result(r, fields[i], resultOptions));
				return result(rows, fields, resultOptions);
			} catch (error) {
				throw databaseError(error);
			} finally {
				restoreWriter?.();
				query.onCancel = void 0;
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
	close(config) {
		return this.#closing ??= (async () => {
			this.#isClosed = true;
			let timer;
			const drain = Promise.allSettled(this.#pending);
			if (config?.timeout === void 0) await drain;
			else {
				await Promise.race([drain, new Promise((resolve) => {
					timer = setTimeout(() => {
						for (const conn of this.#connections) conn.destroy();
						resolve();
					}, config.timeout * 1e3);
				})]);
				clearTimeout(timer);
			}
			if (this.#opening) await this.#opening;
			await this.#pool?.end();
			this.options.onclose?.(null);
		})();
	}
	async connect() {
		if (this.#isClosed) throw clientError("CONNECTION_CLOSED", "Connection closed");
		const connection = await this.#acquire();
		this.#connections.delete(connection);
		connection.release();
	}
};
//#endregion
//#region src/sql.ts
const fragment = Symbol("SQL fragment");
/** Quote a single MySQL identifier without interpreting dots. */
function identifier(name) {
	if (name.includes("\0")) throw new TypeError("SQL identifiers must not contain null bytes");
	return "`" + name.replaceAll("`", "``") + "`";
}
var SQLHelper = class {
	value;
	columns;
	constructor(value, columns) {
		this.value = value;
		this.columns = columns.length === 0 && value[0] !== null && typeof value[0] === "object" ? Object.keys(value[0]) : columns;
		for (const key of this.columns) {
			const number = Number(key);
			if ((typeof key !== "string" || !Number.isNaN(number)) && (!Number.isSafeInteger(number) || number < 0 || number > 65536)) throw new Error(`Keys must be strings or numbers: ${String(key)}`);
		}
	}
};
/** Find the command that determines how a data helper expands. */
function command(text) {
	return text.toLowerCase().replaceAll(/"[^"]*"/gu, "").trim().split(/\s+/u).findLast((token) => [
		"insert",
		"update",
		"set",
		"where",
		"in"
	].includes(token)) ?? "";
}
/** Normalize binary and nullish parameters without interpolating SQL text. */
function bind(value, values, _prefix) {
	if (value === null || value === void 0) values.push(null);
	else if (ArrayBuffer.isView(value)) values.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
	else if (value instanceof ArrayBuffer) values.push(Buffer.from(value));
	else values.push(value);
	return "?";
}
/** Expand a helper according to its INSERT, UPDATE, or IN context. */
function expand(helper, prefix, values) {
	const context = command(prefix);
	const { columns, value: rows } = helper;
	if (![
		"insert",
		"update",
		"set",
		"in"
	].includes(context)) throw new SyntaxError("Helpers are only allowed for INSERT, UPDATE and IN commands");
	if (columns.length === 0 && context !== "in") throw new SyntaxError(`Cannot ${context === "insert" ? "INSERT" : "UPDATE"} with no columns`);
	if (context === "in") {
		if (columns.length > 1 && rows.length > 0) throw new SyntaxError("Cannot use WHERE IN helper with multiple columns");
		return "(" + rows.map((row) => {
			if (columns.length > 0 && row === null) throw new SyntaxError("Cannot use null as an item in WHERE IN helper with a column");
			return bind(columns.length > 0 ? row?.[columns[0]] : row, values, "");
		}).join(", ") + ") ";
	}
	if (context === "insert") {
		if (rows.some((row) => row === null || row === void 0)) throw new SyntaxError("Cannot use null or undefined as an item in INSERT helper");
		const selected = columns.filter((key) => rows.some((row) => row[key] !== void 0));
		if (selected.length === 0) throw new SyntaxError("Insert needs to have at least one column with a defined value");
		return "(" + selected.map((column) => identifier(column)).join(", ") + ") VALUES" + rows.map((row) => "(" + selected.map((key) => bind(row[key], values, "")).join(", ") + ")").join(",") + " ";
	}
	if (rows.length > 1) throw new SyntaxError("Cannot use array of objects for UPDATE");
	const row = rows[0];
	if (row === null || row === void 0) throw new SyntaxError("Cannot use null or undefined as an item in UPDATE helper");
	const selected = columns.filter((key) => row[key] !== void 0);
	if (selected.length === 0) throw new SyntaxError("Update needs to have at least one column");
	return (context === "update" && !prefix.trimEnd().endsWith("ON DUPLICATE KEY UPDATE") ? " SET " : "") + selected.map((key) => `${identifier(key)} = ${bind(row[key], values, "")}`).join(", ") + " ";
}
/** Flatten template fragments and collect bound parameter values. */
function compile(strings, inputs) {
	let text = "";
	const values = [];
	for (const [i, string_] of strings.entries()) {
		text += string_;
		if (i >= inputs.length) continue;
		const value = inputs[i];
		if (value !== null && typeof value === "object" && fragment in value) {
			const nested = value[fragment].compile();
			text += nested.text;
			values.push(...nested.values);
		} else if (value instanceof SQLHelper) text += expand(value, text, values);
		else text += bind(value, values, text) + " ";
	}
	return {
		text,
		values
	};
}
//#endregion
//#region src/query.ts
var Query = class extends Promise {
	static get [Symbol.species]() {
		return Promise;
	}
	[fragment];
	active = false;
	cancelled = false;
	mode = "objects";
	isSimple = false;
	onCancel;
	#started = false;
	#settled = false;
	#resolve;
	#reject;
	#run;
	#compiled;
	#identifier;
	constructor(compile, run, isIdentifier = false) {
		let resolve;
		let reject;
		super((yes, no) => {
			resolve = yes;
			reject = no;
		});
		this.#resolve = resolve;
		this.#reject = reject;
		this.#run = run;
		this.#identifier = isIdentifier;
		this[fragment] = { compile };
	}
	compile() {
		return this.#compiled ??= this[fragment].compile();
	}
	execute() {
		if (this.#started || this.#settled) return this;
		this.#started = true;
		this.active = true;
		try {
			if (this.cancelled) throw clientError("QUERY_CANCELLED", "Query cancelled");
			if (this.#identifier) throw clientError("NOT_TAGGED_CALL", "Query not called as a tagged template literal");
			this.#run(this).then((value) => {
				this.#settled = true;
				this.active = false;
				this.#resolve(value);
			}, (error) => {
				this.#settled = true;
				this.active = false;
				this.#reject(error);
			});
		} catch (error) {
			this.#settled = true;
			this.active = false;
			this.#reject(error);
		}
		return this;
	}
	cancel() {
		this.cancelled = true;
		if (this.#started && !this.#settled) {
			this.onCancel?.();
			this.#reject(clientError("QUERY_CANCELLED", "Query cancelled"));
			this.active = false;
			this.#settled = true;
		}
		return this;
	}
	#prepare() {
		try {
			this.compile();
		} catch (error) {
			this.#settled = true;
			this.#reject(error);
		}
	}
	raw() {
		this.mode = "raw";
		this.#prepare();
		return this;
	}
	values() {
		this.mode = "values";
		this.#prepare();
		return this;
	}
	simple() {
		this.isSimple = true;
		return this;
	}
	then(yes, no) {
		this.execute();
		return super.then(yes, no);
	}
	catch(no) {
		this.execute();
		return super.catch(no);
	}
	finally(callback) {
		this.execute();
		return super.finally(callback);
	}
};
//#endregion
//#region src/client.ts
/** Create a callable SQL client with a lazily initialized connection pool. */
function createSQL(input, overrides = {}) {
	const options = optionsFrom(input, overrides);
	const pool = new ClientPool(options);
	/** Preserve the query runner's receiver when passing it to lazy queries. */
	function run(query) {
		return pool.run(query);
	}
	/** Share the same close function between the public lifecycle aliases. */
	function close(config) {
		return pool.close(config);
	}
	/** Dispatch the upstream template, identifier, and data-helper overloads. */
	function sql(first, ...values) {
		if (typeof first === "string") {
			const text = identifier(first);
			return new Query(() => {
				return {
					text,
					values: []
				};
			}, run, true);
		}
		if (Array.isArray(first) && "raw" in first) return new Query(() => compile(first, values), run);
		return new SQLHelper(Array.isArray(first) ? first : [first], values);
	}
	/** Construct a query from explicitly supplied SQL text. */
	function unsafe(text, values = []) {
		const query = new Query(() => {
			return {
				text,
				values
			};
		}, run);
		if (values.length === 0) query.simple();
		return query;
	}
	Object.assign(sql, {
		options,
		unsafe,
		close,
		end: close,
		file: async (path, values = []) => unsafe(await readFile(path, "utf8"), values),
		connect: async () => {
			await pool.connect();
			return sql;
		},
		[Symbol.asyncDispose]: close
	});
	return sql;
}
const SQL = Object.assign(function SQL(input, options) {
	return createSQL(input, options);
}, {
	SQLError,
	MySQLError
});
//#endregion
export { SQL };
