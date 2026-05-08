// Prisma 7 config. Replaces the deprecated `package.json#prisma` block.
//
// Notes:
// - The generator's `output = "./generated/prisma"` lives in schema.prisma; this
//   file just points the CLI at the schema and migration directory.
// - In v7 the CLI no longer auto-loads `.env`. We pull it in explicitly so
//   `npx prisma migrate dev` and `db:seed` see DATABASE_URL during local dev.
//   In compose, env vars are injected by Docker — the dotenv call just no-ops
//   when there's no .env on disk.

import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// `env()` from prisma/config is eager — it throws at config-load time if the
// var is missing. That's fine for migrate commands (which need DATABASE_URL
// anyway), but `prisma generate` runs during the Docker build with no DB env
// set and only ever reads the schema. We omit the datasource entirely when
// the URL isn't present so generate works in that context.
const datasource = process.env.DATABASE_URL ? { url: env('DATABASE_URL') } : undefined;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  ...(datasource ? { datasource } : {}),
});
