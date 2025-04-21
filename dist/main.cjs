"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// dist/esm/main.js
var main_exports = {};
__export(main_exports, {
  mysql: () => mysql,
  sql: () => sql
});
module.exports = __toCommonJS(main_exports);

// dist/esm/client.js
var import_promise = __toESM(require("mysql2/promise"), 1);

// dist/esm/sql.js
var Sql = class {
  sql;
  values;
  // eslint-disable-next-line no-useless-constructor
  constructor(sql2, values) {
    this.sql = sql2;
    this.values = values;
  }
};
var SqlIdentifier = class {
  id;
  // eslint-disable-next-line no-useless-constructor
  constructor(id2) {
    this.id = id2;
  }
};
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function id(name) {
  return new SqlIdentifier(name);
}
function insert(arg0) {
  if (isPlainObject(arg0)) {
    return insert([arg0]);
  }
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
      for (const prev_row_values of rows_values) {
        prev_row_values.push(null);
      }
    }
    rows_values.push(row_values);
  }
  const ids = rows_keys.map((name) => new SqlIdentifier(name));
  return createSql`(${ids}) VALUES ${rows_values}`;
}
function set(row) {
  const sqls = [];
  for (const [key, value] of Object.entries(row)) {
    sqls.push(createSql`${new SqlIdentifier(key)}=${value}`);
  }
  return sqls;
}
function extendSql(value) {
  return Object.defineProperties(value, {
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
}
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
  if (value instanceof Sql) {
    return value;
  }
  if (value instanceof SqlIdentifier) {
    return new Sql("??", [value.id]);
  }
  return new Sql("?", [value]);
}
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
var sql = extendSql(createSql);

// dist/esm/client.js
function mysql(config) {
  const raw_client = import_promise.default.createPool(config);
  async function createSql2(query, ...values) {
    const [result] = await raw_client.query(sql(query, ...values));
    return result;
  }
  return {
    // client: raw_client,
    // get config() {
    // 	return raw_client.pool.config.connectionConfig;
    // },
    sql: extendSql(createSql2)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mysql,
  sql
});
