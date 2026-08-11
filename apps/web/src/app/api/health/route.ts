import { NextResponse } from 'next/server';

// Server-side proxy: the browser calls this relative URL, and the Next.js
// server (running alongside the API) forwards to the NestJS health endpoint.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

export async function GET() {
  try {
    const res = await fetch(`${API_INTERNAL_URL}/api/v1/health`, { cache: 'no-store' });
    const body: unknown = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        services: { api: 'down', database: 'down', redis: 'down' },
      },
      { status: 503 },
    );
  }
}
