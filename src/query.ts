import { clientError } from './errors.js';
import type { ResultMode } from './results.js';
import { type Compiled, fragment } from './sql.js';
import type { SQL } from './types.js';

export class Query<T> extends Promise<T> implements SQL.Query<T> {
	static override get [Symbol.species](): PromiseConstructor {
		return Promise;
	}

	readonly [fragment]: { compile(): Compiled };
	active = false;
	cancelled = false;
	mode: ResultMode = 'objects';
	isSimple = false;
	onCancel?: () => void;
	#started = false;
	#settled = false;
	#resolve!: (value: T | PromiseLike<T>) => void;
	#reject!: (error: unknown) => void;
	#run: (query: Query<T>) => Promise<T>;
	#compiled?: Compiled;
	#identifier: boolean;

	constructor(
		compile: () => Compiled,
		run: (query: Query<T>) => Promise<T>,
		isIdentifier = false,
	) {
		let resolve!: (value: T | PromiseLike<T>) => void;
		let reject!: (error: unknown) => void;
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

	compile(): Compiled {
		return (this.#compiled ??= this[fragment].compile());
	}

	execute(): this {
		if (this.#started || this.#settled) {
			return this;
		}

		this.#started = true;
		this.active = true;
		try {
			if (this.cancelled) {
				throw clientError('QUERY_CANCELLED', 'Query cancelled');
			}

			if (this.#identifier) {
				throw clientError(
					'NOT_TAGGED_CALL',
					'Query not called as a tagged template literal',
				);
			}

			/* oxlint-disable promise/catch-or-return, promise/prefer-catch, promise/prefer-await-to-then -- Both handlers settle this Promise subclass directly. */
			// eslint-disable-next-line unicorn/prefer-then-catch -- Forward settlement directly to this Promise subclass.
			this.#run(this).then(
				(value) => {
					this.#settled = true;
					this.active = false;
					this.#resolve(value);
				},
				(error) => {
					this.#settled = true;
					this.active = false;
					this.#reject(error);
				},
			);
			/* oxlint-enable promise/catch-or-return, promise/prefer-catch, promise/prefer-await-to-then */
		} catch (error) {
			this.#settled = true;
			this.active = false;
			this.#reject(error);
		}

		return this;
	}

	cancel(): this {
		this.cancelled = true;
		if (this.#started && !this.#settled) {
			this.onCancel?.();
			this.#reject(clientError('QUERY_CANCELLED', 'Query cancelled'));
			this.active = false;
			this.#settled = true;
		}

		return this;
	}

	#prepare(): void {
		try {
			this.compile();
		} catch (error) {
			this.#settled = true;
			this.#reject(error);
		}
	}

	raw(): this {
		this.mode = 'raw';
		this.#prepare();
		return this;
	}

	values(): this {
		this.mode = 'values';
		this.#prepare();
		return this;
	}

	simple(): this {
		this.isSimple = true;
		return this;
	}

	// oxlint-disable-next-line unicorn/no-thenable -- Bun SQL queries are lazy Promise subclasses.
	override then<A = T, B = never>(
		yes?: ((value: T) => A | PromiseLike<A>) | null,
		no?: ((reason: unknown) => B | PromiseLike<B>) | null,
	): Promise<A | B> {
		this.execute();
		// eslint-disable-next-line unicorn/prefer-then-catch -- Preserve Promise.then fulfillment/rejection semantics.
		return super.then(yes, no);
	}

	override catch<A = never>(
		no?: ((reason: unknown) => A | PromiseLike<A>) | null,
	): Promise<T | A> {
		this.execute();
		return super.catch(no);
	}

	override finally(callback?: (() => void) | null): Promise<T> {
		this.execute();
		return super.finally(callback);
	}
}
