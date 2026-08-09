import type { NextConfig } from 'next';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
        ],
      },
    ];
  },
};

export default nextConfig;
