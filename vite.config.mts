import { vendureDashboardPlugin } from '@vendure/dashboard/vite';
import { join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { defineConfig, type Plugin } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const serverPort = Number(process.env.PORT || process.env.VENDURE_SERVER_PORT || 3000);

/** The logo's blue, used for buttons, links and the sidebar highlight. */
const brandBlue = {
    primary: 'oklch(0.58 0.19 255)',
    'primary-foreground': 'oklch(0.99 0 0)',
    ring: 'oklch(0.58 0.19 255)',
    'sidebar-primary': 'oklch(0.58 0.19 255)',
    'sidebar-primary-foreground': 'oklch(0.99 0 0)',
    'sidebar-ring': 'oklch(0.58 0.19 255)',
    brand: 'oklch(0.58 0.19 255)',
};

/** The dashboard's page shell: tab title, description and home-screen icon. */
function vitaminShopIndexHtml(): Plugin {
    return {
        name: 'vitamin-shop:index-html',
        transformIndexHtml(html) {
            return html
                .replace('content="Vendure Admin Dashboard"', 'content="VITAMIN SHOP dashboard"')
                .replace('content="Vendure"', 'content="Vitamin 2001"')
                .replace(
                    '</head>',
                    '    <title>VITAMIN SHOP</title>\n    <link rel="apple-touch-icon" href="apple-touch-icon.png" />\n</head>',
                );
        },
    };
}

export default defineConfig({
    base: '/dashboard',
    // Replaces the dashboard's own public folder, which only holds the Vendure favicon.
    publicDir: join(projectRoot, 'static/dashboard'),
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
            theme: {
                light: brandBlue,
                dark: { ...brandBlue, primary: 'oklch(0.68 0.17 250)', ring: 'oklch(0.68 0.17 250)' },
            },
        }),
        vitaminShopIndexHtml(),
    ],
    resolve: {
        alias: {
            '@/gql': resolve(projectRoot, 'src/gql/graphql.ts'),
        },
    },
});
