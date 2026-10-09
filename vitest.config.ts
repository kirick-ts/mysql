import { defineConfig } from 'vitest/config';

// eslint-disable-next-line no-restricted-exports -- The tool expects a default configuration export.
export default defineConfig({
	esbuild: { tsconfigRaw: { compilerOptions: { target: 'ES2024' } } },
	test: { fileParallelism: false },
});
