"use strict";
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
const mysql2_promise = __toESM(require("mysql2/promise"));

//#region src/sql.ts
var Sql = class {
	constructor(sql$1, values) {
		this.sql = sql$1;
		this.values = values;
	}
};
var SqlIdentifier = class {
	constructor(id$1) {
		this.id = id$1;
	}
};
/**
* @param value -
* @returns -
*/
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Escapes an identifier.
* @param name - Identifier name.
* @returns -
*/
function id(name) {
	return new SqlIdentifier(name);
}
function insert(arg0) {
	if (isPlainObject(arg0)) return insert([arg0]);
	const rows_keys = [];
	const rows_values = [];
	for (const row of structuredClone(arg0)) {
		const row_values = [];
		for (const key of rows_keys) {
			row_values.push(row[key] ?? null);
			delete row[key];
		}
		for (const [key, value] of Object.entries(row)) {
			rows_keys.push(key);
			row_values.push(value);
			for (const prev_row_values of rows_values) prev_row_values.push(null);
		}
		rows_values.push(row_values);
	}
	const ids = rows_keys.map((name) => new SqlIdentifier(name));
	return createSql`(${ids}) VALUES ${rows_values}`;
}
/**
* @param row -
* @returns -
*/
function set(row) {
	const sqls = [];
	for (const [key, value] of Object.entries(row)) sqls.push(createSql`${new SqlIdentifier(key)}=${value}`);
	return sqls;
}
/**
* Converts a value to a SQL string representation.
* @param value -
* @param depth -
* @returns -
*/
function toSql(value, depth = 0) {
	if (Array.isArray(value) || value instanceof Set) {
		const result_sql_parts = [];
		const result_values = [];
		for (const item of value) {
			const sql_nested = toSql(item, depth + 1);
			result_sql_parts.push(sql_nested.sql);
			result_values.push(...sql_nested.values);
		}
		return new Sql((depth > 0 ? "(" : "") + result_sql_parts.join(",") + (depth > 0 ? ")" : ""), result_values);
	}
	if (value instanceof Sql) return value;
	if (value instanceof SqlIdentifier) return new Sql("??", [value.id]);
	return new Sql("?", [value]);
}
/**
* Creates SQL Query object from template string tag.
* @param query -
* @param values -
* @returns -
*/
function createSql(query, ...values) {
	const result_sql_parts = [query[0]];
	const result_values = [];
	for (const [index, value] of values.entries()) {
		const sql_nested = toSql(value);
		result_sql_parts.push(sql_nested.sql);
		result_values.push(...sql_nested.values);
		result_sql_parts.push(query[index + 1]);
	}
	return new Sql(result_sql_parts.join(""), result_values);
}
const sql = Object.defineProperties(createSql, {
	empty: {
		configurable: false,
		enumerable: false,
		writable: false,
		value: createSql``
	},
	id: {
		configurable: false,
		enumerable: false,
		writable: false,
		value: id
	},
	insert: {
		configurable: false,
		enumerable: false,
		writable: false,
		value: insert
	},
	set: {
		configurable: false,
		enumerable: false,
		writable: false,
		value: set
	}
});

//#endregion
//#region src/client.ts
/**
* Creates a new mysql client. Connects to the server automatically.
* @param config - Client configuration.
* @returns - Mysql client.
*/
function mysql(config) {
	const raw_client = mysql2_promise.default.createPool(config);
	return { async sql(query, ...values) {
		const [result] = await raw_client.query(sql(query, ...values));
		return result;
	} };
}

//#endregion
exports.mysql = mysql
exports.sql = sql