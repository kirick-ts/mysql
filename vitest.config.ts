import { defineConfig } from 'vitest/config';

export default defineConfig({
	esbuild: { tsconfigRaw: { compilerOptions: { target: 'ES2024' } } },
	test: { fileParallelism: false },
});
