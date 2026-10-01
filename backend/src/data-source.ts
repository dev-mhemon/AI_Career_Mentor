import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from './users/entities/user.entity.js';
import { InvitationCode } from './invitation-codes/entities/invitation-code.entity.js';

/**
 * Standalone DataSource for TypeORM CLI operations (migrations).
 *
 * Usage:
 *   npx typeorm-ts-node-esm migration:generate -d src/data-source.ts src/migrations/<Name>
 *   npx typeorm-ts-node-esm migration:run -d src/data-source.ts
 *
 * Environment variables are read directly here because the NestJS
 * ConfigModule is not available outside the application context.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'ai_career_mentor',
  entities: [User, InvitationCode],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
  logging: true,
});
