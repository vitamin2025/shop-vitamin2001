import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.e2e-spec.ts'],
        testTimeout: 60_000,
        hookTimeout: 120_000,
        fileParallelism: false,
    },
    plugins: [
        // Vendure plugins use decorators with emitted metadata, which esbuild does not produce.
        swc.vite({ jsc: { transform: { useDefineForClassFields: false } } }),
    ],
});
