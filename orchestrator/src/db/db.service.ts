import { OnModuleDestroy } from "@nestjs/common";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

export interface DbConfig {
  databaseUrl?: string | undefined;
}

export const DB_CONFIG = Symbol("DB_CONFIG");

export function loadDbConfig(): DbConfig {
  return {
    databaseUrl: process.env.DATABASE_URL,
  };
}

export function createDbService(config: DbConfig = {}): DbService {
  return new DbService(config);
}

/** Shared Postgres access for orchestration state. */
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(config: DbConfig = {}) {
    this.pool = new Pool({ connectionString: config.databaseUrl ?? process.env.DATABASE_URL });
  }

  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
    return this.pool.query<Row>(text, values);
  }

  connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
