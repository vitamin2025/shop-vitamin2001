import { PluginCommonModule, VendurePlugin } from '@vendure/core';

/** The store's name shown across the dashboard. */
export const BRAND_NAME = 'VITAMIN SHOP';

/**
 * Brands the dashboard as VITAMIN SHOP: the logo and welcome text on the sign-in page,
 * the logo in the top bar, and the browser tab title. The favicon and colours are set in
 * vite.config.mts, where the dashboard is built.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    dashboard: './dashboard/index.tsx',
    compatibility: '^3.0.0',
})
export class VitaminBrandingPlugin {}
