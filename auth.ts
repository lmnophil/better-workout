// Full Auth.js v5 configuration.
//
// Extends the Edge-safe config in auth.config.ts with:
//   - Prisma adapter (for User, Account, VerificationToken persistence)
//   - Resend provider (magic links via email)
//
// JWT session strategy is used (rather than database sessions) so that
// middleware can verify auth without a database call on every request.
// The Prisma adapter still handles user creation + OAuth account linking.

import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Resend from 'next-auth/providers/resend';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { metrics } from '@/lib/metrics';
import authConfig from './auth.config';

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: {
    strategy: 'jwt',
    // 1 year max lifetime. A user who comes back from a long hiatus shouldn't
    // be forced to re-auth — this is a fitness tracker, not a banking app.
    // Tune down if your threat model demands it.
    maxAge: 60 * 60 * 24 * 365,
    // Refresh the cookie at most once per day on activity. Saves writes
    // without meaningfully shortening the session.
    updateAge: 60 * 60 * 24,
  },
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Resend({
      from: process.env.AUTH_EMAIL_FROM,
      apiKey: process.env.AUTH_RESEND_KEY,
    }),
  ],
  events: {
    signIn({ user, account, isNewUser }) {
      logger.info(
        {
          userId: user.id,
          provider: account?.provider,
          isNewUser: Boolean(isNewUser),
        },
        'auth.signin',
      );
      // Auth.js sets isNewUser explicitly on first sign-in, omits it on
      // subsequent ones (including via OAuth re-link). Distinguish all three
      // rather than bucketing 'undefined' with 'signin'.
      const event =
        isNewUser === true ? 'signup' : isNewUser === false ? 'signin' : 'signin_unknown';
      metrics.authEvents.inc({
        event,
        provider: account?.provider ?? 'unknown',
      });
    },
    signOut(message) {
      // The shape of `message` varies by session strategy; pull userId where present.
      const userId =
        'token' in message ? (message.token?.sub ?? null) : (message.session?.userId ?? null);
      logger.info({ userId }, 'auth.signout');
      metrics.authEvents.inc({ event: 'signout', provider: 'n/a' });
    },
    createUser({ user }) {
      logger.info({ userId: user.id }, 'auth.user_created');
    },
    linkAccount({ user, account }) {
      logger.info(
        { userId: user.id, provider: account.provider },
        'auth.account_linked',
      );
    },
  },
});

// Augment the default session and JWT shapes so TypeScript knows about user.id
// and token.userId. This lets server components and callbacks work without casts.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
  }
}
