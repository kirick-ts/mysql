import type { QueryOptions } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

// mysql2 3.14.1 encodes every number as DOUBLE and every bigint as a string.
// Neither matches Bun (or MariaDB's result metadata). Adapt only the outbound
// COM_STMT_EXECUTE packet on an exclusively acquired connection. Authentication,
// statement caching, framing, response parsing, and pooling remain mysql2's.
// This small internal boundary is why mysql2 is pinned and the Docker matrix
// must pass before upgrading it. The original writer is always restored.
interface Packet {
	buffer: Buffer;
	start: number;
	end: number;
	offset: number;
}
interface PacketWriter {
	writePacket(packet: Packet): void;
}
interface Parameter {
	type: number;
	unsigned: number;
	bytes: Buffer;
}

/** Prefix bytes with a MySQL length-encoded integer. */
function lengthEncoded(bytes: Buffer): Buffer {
	let prefix: Buffer;
	if (bytes.length < 251) {
		prefix = Buffer.from([bytes.length]);
	} else if (bytes.length < 65536) {
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
function encodeNumber(value: number): Parameter {
	if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
		if (value >= -2147483648 && value <= 4294967295) {
			const bytes = Buffer.alloc(4);
			const unsigned = value > 2147483647 ? 128 : 0;
			if (unsigned) {
				bytes.writeUInt32LE(value);
			} else {
				bytes.writeInt32LE(value);
			}

			return { type: 3, unsigned, bytes };
		}

		return encode(BigInt(value));
	}

	const bytes = Buffer.alloc(8);
	bytes.writeDoubleLE(value);
	return { type: 5, unsigned: 0, bytes };
}

/** Encode one bound value using Bun-compatible MySQL parameter types. */
function encode(value: unknown): Parameter {
	if (value === null || value === undefined) {
		return { type: 6, unsigned: 0, bytes: Buffer.alloc(0) };
	}

	if (typeof value === 'boolean') {
		return { type: 1, unsigned: 0, bytes: Buffer.from([Number(value)]) };
	}

	if (typeof value === 'number') {
		return encodeNumber(value);
	}

	if (typeof value === 'bigint') {
		const bytes = Buffer.alloc(8);
		const unsigned = value > 9223372036854775807n ? 128 : 0;
		if (unsigned) {
			bytes.writeBigUInt64LE(value);
		} else {
			bytes.writeBigInt64LE(value);
		}

		return { type: 8, unsigned, bytes };
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
		bytes.writeUInt32LE(value.getUTCMilliseconds() * 1000, 8);
		return { type: 12, unsigned: 0, bytes };
	}

	if (Buffer.isBuffer(value)) {
		return { type: 252, unsigned: 0, bytes: lengthEncoded(value) };
	}

	if (typeof value === 'object') {
		return {
			type: 254,
			unsigned: 0,
			bytes: lengthEncoded(Buffer.from(JSON.stringify(value))),
		};
	}

	return {
		type: 254,
		unsigned: 0,
		bytes: lengthEncoded(Buffer.from(String(value))),
	};
}

const signatures = new WeakMap<object, Map<string, string>>();

/** Install a query-local packet adapter and return its cleanup callback. */
export function bindParameters(
	connection: PoolConnection,
	request: QueryOptions,
	values: unknown[],
): () => void {
	const writer = connection.connection as unknown as PacketWriter;
	const original = writer.writePacket;
	const parameters = values.map((value) => encode(value));
	let cache = signatures.get(connection.connection);
	if (!cache) {
		cache = new Map();
		signatures.set(connection.connection, cache);
	}

	const signature = parameters
		.map((parameter) => `${parameter.type}:${parameter.unsigned}`)
		.join(',');
	if (cache.get(request.sql) !== signature) {
		// MySQL fixes inferred parameter types on first execution. Bun uses
		// separate prepared statements for different binding types.
		connection.unprepare(request);
		cache.set(request.sql, signature);
		if (cache.size > 1024) {
			cache.delete(cache.keys().next().value!);
		}
	}

	writer.writePacket = function (packet: Packet): void {
		if (parameters.length > 0 && packet.buffer[packet.start + 4] === 0x17) {
			// Four-byte framing header, command, statement ID, cursor, iterations.
			const header = packet.buffer.subarray(packet.start, packet.start + 14);
			const bitmap = Buffer.alloc(Math.ceil(parameters.length / 8));
			const types = Buffer.alloc(parameters.length * 2);
			for (const [i, parameter] of parameters.entries()) {
				if (parameter.type === 6) {
					// oxlint-disable-next-line no-bitwise -- Encode the MySQL NULL bitmap.
					bitmap[i >> 3]! |= 1 << (i & 7);
				}

				types[i * 2] = parameter.type;
				types[i * 2 + 1] = parameter.unsigned;
			}

			packet.buffer = Buffer.concat([
				header,
				bitmap,
				Buffer.from([1]),
				types,
				...parameters.map((parameter) => parameter.bytes),
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
