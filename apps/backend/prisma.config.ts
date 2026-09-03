import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    // Prisma Migrate and other CLI commands need a direct,
    // non-pooled connection — see DIRECT_URL vs DATABASE_URL note below.
    datasource: {
        url: env('DIRECT_URL'),
    },
});
