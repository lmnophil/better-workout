import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // Don't generate the service worker in dev — it caches too aggressively
  // and makes hot reload annoying.
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output produces a minimal Docker image
  output: 'standalone',
  // Reactivate strict mode for catching issues in dev
  reactStrictMode: true,
  experimental: {
    // Server actions are stable in Next 15 but we declare allowed origins
    // for production CSRF protection. Update with your real domain.
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
};

export default withSerwist(nextConfig);
