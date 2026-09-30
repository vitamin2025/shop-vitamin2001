import { vendureDashboardPlugin } from '@vendure/dashboard/vite';
import { join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const serverPort = Number(process.env.PORT || process.env.VENDURE_SERVER_PORT || 3000);

export default defineConfig({
    base: '/dashboard',
    build: {
        outDir: join(projectRoot, 'dist/dashboard'),
        emptyOutDir: true,
    },
    plugins: [
        vendureDashboardPlugin({
            vendureConfigPath: pathToFileURL(join(projectRoot, 'src/vendure-config.ts')),
            // Vite sets NODE_ENV=production for `vite build`, so the published
            // dashboard calls back to whatever host served it.
            api:
                process.env.NODE_ENV === 'production'
                    ? { host: 'auto', port: 'auto' }
                    : { host: 'http://localhost', port: serverPort },
            gqlOutputPath: join(projectRoot, 'src/gql'),
        }),
    ],
    resolve: {
        alias: {
            '@/gql': resolve(projectRoot, 'src/gql/graphql.ts'),
        },
    },
});
