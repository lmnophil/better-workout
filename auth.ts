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
  callbacks: {
    ...authConfig.callbacks,
    // Override the Edge-side jwt callback so we can hit the DB. The spread
    // above brings the Edge callback in scope but the whole jwt key is
    // overridden here, so the userId-set behavior from auth.config.ts is
    // mirrored explicitly. Every request: confirm the JWT's userId still maps
    // to a real user — covers the `prisma migrate reset` case where the cookie
    // outlives the user row. A single indexed PK lookup per request is cheap.
    // Returning null makes `auth()` see no session, which the (app) layout
    // routes to `/api/auth/recover` — the cookie clearing happens there, not
    // here, because the JWT callback can't set response cookies directly.
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      if (token.userId) {
        const exists = await db.user.findUnique({
          where: { id: token.userId },
          select: { id: true },
        });
        if (!exists) {
          logger.info({ userId: token.userId }, 'auth.jwt_invalidated_user_missing');
          return null;
        }
      }
      return token;
    },
  },
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
      logger.info({ userId: user.id, provider: account.provider }, 'auth.account_linked');
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

// TS only resolves a `declare module` augmentation if it has already seen the
// module elsewhere in the type graph. The empty type-only import does that
// without affecting the runtime bundle.
import type {} from 'next-auth/jwt';

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
  }
}
