"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPool = createPool;
exports.withTransaction = withTransaction;
const pg_1 = require("pg");
pg_1.types.setTypeParser(20, (v) => parseInt(v, 10));
pg_1.types.setTypeParser(1700, (v) => parseInt(v, 10));
function createPool(config) {
    return new pg_1.Pool(config);
}
async function withTransaction(pool, fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => {
        });
        throw err;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=db.js.map