import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CartDrawer } from '@/components/cart-drawer';
import { Providers } from '@/components/providers';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Bokku Logistics',
    template: '%s · Bokku Logistics',
  },
  description: 'Shop from Bokku and get your order delivered fast.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
          <CartDrawer />
        </Providers>
      </body>
    </html>
  );
}
