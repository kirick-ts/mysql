import { defineConfig } from 'tsdown';

export default defineConfig({
	fixedExtension: true,
	// Bun's ambient declarations must remain imports in the published types.
	deps: { neverBundle: ['bun'] },
	hooks: {
		'build:prepare'({ options }) {
			// --unused overrides static configuration. Apply the declaration-only
			// dependency exception after CLI options have been resolved.
			if (options.unused) {
				options.unused = { ...options.unused, ignore: ['bun-types'] };
			}
		},
	},
});
