import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor() {
        // Runtime queries go through the POOLED connection (DATABASE_URL,
        // port 6543, ?pgbouncer=true) — this is what should handle the
        // high-frequency, short-lived connections a running API makes.
        const adapter = new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        });
        super({ adapter });
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}
