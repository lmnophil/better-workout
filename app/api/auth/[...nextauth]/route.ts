// Auth.js route handler. Exposes the standard endpoints:
//   GET/POST /api/auth/signin
//   GET/POST /api/auth/signout
//   GET      /api/auth/callback/{provider}
//   ...and the rest.

import { handlers } from '@/auth';

export const { GET, POST } = handlers;

// We export the runtime explicitly so OAuth callbacks run on Node
// (Resend's email sending requires Node, and Prisma adapter is Node-only).
export const runtime = 'nodejs';
