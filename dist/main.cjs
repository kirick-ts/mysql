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
var sqlTemplateTag = __toESM(require("sql-template-tag"), 1);
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function id(name) {
  return new sqlTemplateTag.Sql(["", "?"], [name]);
}
function insert(arg0) {
  if (isPlainObject(arg0)) {
    return insert([arg0]);
  }
  const rows_keys = Object.keys(arg0[0]);
  const rows_values = [];
  for (const [index, row] of arg0.entries()) {
    for (const key of Object.keys(row)) {
      if (!rows_keys.includes(key)) {
        throw new Error(`Unexpected key "${key}" in row ${index}.`);
      }
    }
    rows_values.push(Object.values(row));
  }
  const keys_sql = new sqlTemplateTag.Sql([
    "(?",
    ...Array.from({ length: rows_keys.length - 1 }).fill(",?"),
    ")"
  ], rows_keys);
  return sqlTemplateTag.default`${keys_sql} VALUES ${sqlTemplateTag.bulk(rows_values)}`;
}
function set(row) {
  const row_entries = Object.entries(row);
  const values = [];
  for (const [key, value] of row_entries) {
    values.push(key, value);
  }
  const sql_parts = [];
  for (let index = 0; index < row_entries.length; index++) {
    sql_parts.push(`${index > 0 ? "," : ""}?`, "=");
  }
  sql_parts.push("");
  return new sqlTemplateTag.Sql(sql_parts, values);
}
function createSql(query, ...values) {
  const sql_query = new sqlTemplateTag.Sql(query, values);
  return {
    sql: sql_query.sql,
    values: sql_query.values
  };
}
var sql = Object.defineProperties(createSql, {
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

// dist/esm/client.js
function mysql(config) {
  const raw_client = import_promise.default.createPool(config);
  return {
    // client: raw_client,
    get config() {
      return raw_client.config;
    },
    async sql(query, ...values) {
      const [result] = await raw_client.query(sql(query, ...values));
      return result;
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mysql,
  sql
});
