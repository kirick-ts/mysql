/// <reference types="bun-types" preserve="true" />
import { SQL as SQL$1 } from "bun";
//#region src/types.d.ts
type Unsupported = 'begin' | 'transaction' | 'beginDistributed' | 'distributed' | 'commitDistributed' | 'rollbackDistributed' | 'reserve' | 'listen' | 'notify' | 'array' | 'flush';
type SQL$2 = SQL$1 & Record<Unsupported, never>;
declare namespace SQL$2 {
  type Options = SQL$1.Options;
  type Query<T> = SQL$1.Query<T>;
  type Helper<T> = SQL$1.Helper<T>;
  type MySQLError = SQL$1.MySQLError;
  type SQLError = SQL$1.SQLError;
}
type SQLConstructor = Pick<typeof SQL$1, 'SQLError' | 'MySQLError'> & {
  new (url: string | URL, options?: SQL$1.PostgresOrMySQLOptions): SQL$2;
  new (options: SQL$1.PostgresOrMySQLOptions): SQL$2;
};
//#endregion
//#region src/client.d.ts
export declare const SQL: SQLConstructor;
export type SQL = SQL$2;
export declare namespace SQL {
  type Options = SQL$1.Options;
  type PostgresOrMySQLOptions = SQL$1.PostgresOrMySQLOptions;
  type Query<T> = SQL$1.Query<T>;
  type Helper<T> = SQL$1.Helper<T>;
  type MySQLError = SQL$1.MySQLError;
  type SQLError = SQL$1.SQLError;
}
//#endregion