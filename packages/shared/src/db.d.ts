import { Pool, PoolClient, PoolConfig } from 'pg';
export declare function createPool(config: PoolConfig): Pool;
export declare function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T>;
export type { Pool, PoolClient, PoolConfig };
