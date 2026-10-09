import type { FieldPacket, ResultSetHeader, TypeCast } from 'mysql2';
import mysql2 from 'mysql2';

const { Types } = mysql2;

export type ResultMode = 'objects' | 'values' | 'raw';

export interface ResultOptions {
	mode: ResultMode;
	shouldUseBigInt: boolean;
	isSimple: boolean;
}

class SQLResultArray extends Array<unknown> {
	count = 0;
	command = null;
	lastInsertRowid: number | string = 0;
	affectedRows = 0;

	static override get [Symbol.species](): ArrayConstructor {
		return Array;
	}
}

/** Preserve raw field bytes before mysql2 performs value conversion. */
export function typeCast(mode: ResultMode, isSimple: boolean): TypeCast {
	return (field, next) => {
		if (field.type === 'GEOMETRY') {
			return field.buffer();
		}

		if (
			mode === 'raw'
			&& (isSimple
				|| [
					'DECIMAL',
					'NEWDECIMAL',
					'JSON',
					'VARCHAR',
					'VAR_STRING',
					'STRING',
					'TINY_BLOB',
					'MEDIUM_BLOB',
					'LONG_BLOB',
					'BLOB',
					'ENUM',
					'SET',
				].includes(field.type))
		) {
			return field.buffer();
		}

		return next();
	};
}

/** Reconstruct the numeric bytes returned by Bun's raw result mode. */
function rawNumeric(
	value: unknown,
	type: FieldPacket['columnType'],
	isUnsigned: boolean,
): Buffer | undefined {
	const sizes: Record<number, number> = {
		[Types.TINY]: 1,
		[Types.SHORT]: 2,
		[Types.YEAR]: 2,
		[Types.LONG]: 4,
		[Types.INT24]: 3,
		[Types.LONGLONG]: 8,
		[Types.FLOAT]: 4,
		[Types.DOUBLE]: 8,
	};
	const size = type === undefined ? undefined : sizes[type];
	if (size) {
		const buffer = Buffer.alloc(size);
		switch (type) {
			case Types.LONGLONG:
				if (isUnsigned) {
					buffer.writeBigUInt64LE(BigInt(String(value)));
				} else {
					buffer.writeBigInt64LE(BigInt(String(value)));
				}

				break;

			case Types.FLOAT:
				buffer.writeFloatLE(Number(value));
				break;

			case Types.DOUBLE:
				buffer.writeDoubleLE(Number(value));
				break;

			default:
				if (isUnsigned || type === Types.YEAR) {
					buffer.writeUIntLE(Number(value), 0, size);
				} else {
					buffer.writeIntLE(Number(value), 0, size);
				}
		}

		return buffer;
	}

	return undefined;
}

/** Apply Bun value and raw-result decoding to a single field. */
function decode(
	value: unknown,
	field: FieldPacket,
	{ mode, shouldUseBigInt, isSimple }: ResultOptions,
): unknown {
	if (value === null) {
		return null;
	}

	const type = field.columnType;
	const isUnsigned =
		// oxlint-disable-next-line no-bitwise -- MySQL's unsigned-column flag is a protocol bitmask.
		typeof field.flags === 'number' && (field.flags & 32) !== 0;
	if (
		type === Types.BIT
		&& field.columnLength === 1
		&& Buffer.isBuffer(value)
	) {
		return value[0] !== 0;
	}

	if (mode === 'raw' && !isSimple) {
		const bytes = rawNumeric(value, type, isUnsigned);
		if (bytes !== undefined) {
			return bytes;
		}
	}

	if (type === Types.LONGLONG && !(mode === 'raw' && isSimple)) {
		const integer = BigInt(String(value));
		if (
			integer >= (isUnsigned ? 0n : -2147483648n)
			&& integer <= (isUnsigned ? 4294967295n : 2147483647n)
		) {
			return Number(integer);
		}

		return shouldUseBigInt ? integer : String(value);
	}

	if (type === Types.TIME && !isSimple && typeof value === 'string') {
		return value.split('.', 1)[0];
	}

	return value;
}

/** Construct the public row array and its write-result metadata. */
export function result(
	rows: unknown,
	fields: FieldPacket[] | undefined,
	options: ResultOptions,
): SQLResultArray {
	const output = new SQLResultArray();
	if (!Array.isArray(rows)) {
		const header = rows as ResultSetHeader;
		output.lastInsertRowid = header.insertId;
		output.affectedRows = header.affectedRows;
		return output;
	}

	for (const row of rows as unknown[][]) {
		const values = row.map((value, i) => decode(value, fields![i]!, options));
		if (options.mode === 'objects') {
			// Define own data properties even for names such as __proto__.
			output.push(
				Object.fromEntries(fields!.map((field, i) => [field.name, values[i]])),
			);
		} else {
			output.push(values);
		}
	}

	output.count = output.length;
	return output;
}
