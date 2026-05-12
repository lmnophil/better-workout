import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    // `id` pins the PWA identity independently of `start_url`, so a future
    // tweak to start_url doesn't make installed copies look like a different
    // app to the browser and trigger a re-install / loss-of-state prompt.
    id: '/',
    name: 'Workout Tracker',
    short_name: 'Workout',
    description:
      'Track sets, reps, and muscle group coverage. Self-hosted, no opinions.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#16110d',
    theme_color: '#16110d',
    categories: ['fitness', 'health', 'lifestyle'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
