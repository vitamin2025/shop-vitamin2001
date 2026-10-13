import { defineDashboardExtension } from '@vendure/dashboard';
import { useEffect, type ReactNode } from 'react';

import logoUrl from './vitamin-shop-logo.png';

const BRAND_NAME = 'VITAMIN SHOP';

function BrandMark({ size }: Readonly<{ size: 'large' | 'small' }>) {
    const large = size === 'large';
    return (
        <div className={`flex items-center ${large ? 'flex-col gap-2' : 'gap-2'}`}>
            <img src={logoUrl} alt="" className={large ? 'h-20 w-20' : 'h-7 w-7'} />
            <span
                className={`font-heading font-bold tracking-[0.2em] text-foreground ${large ? 'text-xl' : 'hidden text-sm sm:inline'}`}
            >
                {BRAND_NAME}
            </span>
        </div>
    );
}

function LoginWelcome() {
    return (
        <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome to {BRAND_NAME}</h1>
            <p className="text-sm text-muted-foreground">Sign in to manage your shop</p>
        </div>
    );
}

/** The dashboard titles each tab "Page • Vendure"; this swaps in the store's name. */
function BrandedTitle({ children }: Readonly<{ children: ReactNode }>) {
    useEffect(() => {
        const rename = () => {
            const branded = document.title.replace(/Vendure/g, BRAND_NAME);
            if (branded !== document.title) {
                document.title = branded;
            }
        };
        rename();
        const observer = new MutationObserver(rename);
        observer.observe(document.head, { subtree: true, childList: true, characterData: true });
        return () => observer.disconnect();
    }, []);
    return <>{children}</>;
}

defineDashboardExtension({
    login: {
        logo: { component: () => <BrandMark size="large" /> },
        beforeForm: { component: LoginWelcome },
    },
    toolbarItems: [
        {
            id: 'vitamin-shop-brand',
            component: () => <BrandMark size="small" />,
            position: { itemId: 'alerts', order: 'before' },
        },
    ],
    customProviders: [{ id: 'vitamin-shop-title', component: BrandedTitle, location: 'app' }],
});
