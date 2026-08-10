import type { NextConfig } from 'next';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework version in response headers.
  poweredByHeader: false,
  // Transpile workspace TypeScript packages.
  transpilePackages: ['@bokku/shared', '@bokku/validation'],
  // The sandbox/preview runs under rotating *.e2b.app subdomains.
  allowedDevOrigins: ['*.e2b.app'],
  // Browser code always calls the same-origin path; the Next.js server
  // proxies to the NestJS API, so no internal URL reaches the client.
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_INTERNAL_URL}/api/v1/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // HSTS is ignored over plain http:// (dev) but pins HTTPS behind
          // any TLS-terminating deploy. The storefront needs no device APIs.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ];
  },
};

export default nextConfig;
