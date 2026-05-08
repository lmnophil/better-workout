// Edge-safe Auth.js config — used by middleware which runs on the Edge runtime.
//
// IMPORTANT: This config must NOT import anything Edge-incompatible:
//   - No Prisma adapter (it's added in auth.ts)
//   - No Resend provider (uses Node APIs — added in auth.ts)
//
// Google OAuth provider IS Edge-safe so it lives here, which is why
// google-callback URLs work properly through middleware.

import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

export default {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: '/signin',
    verifyRequest: '/verify-request',
  },
  callbacks: {
    // Add userId to the JWT so server components can identify the user
    // without a DB hit.
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
