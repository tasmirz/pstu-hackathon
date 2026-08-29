import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { READ_POOL } from '../../db/db.module';

@Injectable()
export class NotificationsService {
  constructor(@Inject(READ_POOL) private readonly pool: Pool) {}

  async list(userId: number, unread?: boolean, cursor?: number, limit = 20) {
    const limitPlusOne = limit + 1;

    const { rows } = await this.pool.query(
      `SELECT id, user_id, kind, title, body, txn_id, read_at, created_at
       FROM notify.notifications
       WHERE user_id = $1
         AND ($2::boolean IS NULL OR ($2 = true AND read_at IS NULL) OR ($2 = false AND read_at IS NOT NULL))
         AND ($3::bigint IS NULL OR id < $3::bigint)
       ORDER BY id DESC
       LIMIT $4`,
      [userId, unread ?? null, cursor ?? null, limitPlusOne],
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: pageRows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        txn_id: r.txn_id,
        read_at: r.read_at,
        created_at: r.created_at,
      })),
      next_cursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
      has_more: hasMore,
    };
  }

  async markAsRead(userId: number, notificationId: number) {
    const { rows } = await this.pool.query(
      `UPDATE notify.notifications
       SET read_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, kind, title, body, txn_id, read_at, created_at`,
      [notificationId, userId],
    );

    if (rows.length === 0) {
      throw new NotFoundException('Notification not found');
    }

    return rows[0];
  }

  async markAllAsRead(userId: number) {
    const { rows } = await this.pool.query(
      `UPDATE notify.notifications
       SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL
       RETURNING id`,
      [userId],
    );

    return { updated_count: rows.length };
  }
}
