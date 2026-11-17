import {pool} from '../db';
import {Pool, PoolClient} from 'pg';

type Db = Pool | PoolClient;

export interface RawPosition {
    instrumentId: number;
    ticker: string;
    name: string;
    quantity: number;
    avgBuyPrice: number;
    lastPrice: number | null;
    previousClose: number | null;
}

export type NewOrder = {userId: number; instrumentId: number} & (
    | {
        side: 'CASH_IN' | 'CASH_OUT';
        type: 'MARKET';
        size: number;
        amount?: never;
    }
    | {
        side: 'BUY' | 'SELL';
        type: 'MARKET' | 'LIMIT';
        size?: number;
        amount?: number;
        price?: number;
    }
);

export interface Order {
    id: number;
    instrumentId: number;
    userId: number;
    size: number;
    price: number | null;
    type: string;
    side: string;
    status: string;
    datetime: Date;
}

export interface OrderWithInstrument extends Order {
    ticker: string;
    name: string;
}

export async function listOrders(userId: number): Promise<OrderWithInstrument[]> {
    const {rows} = await pool.query<OrderWithInstrument>(
        `SELECT o.id,
            o.instrumentid AS "instrumentId",
            i.ticker,
            i.name,
            o.userid AS "userId",
            o.size,
            o.price::float8 AS price,
            o.type,
            o.side,
            o.status,
            o.datetime
       FROM orders o
       JOIN instruments i ON i.id = o.instrumentid
      WHERE o.userid = $1
      ORDER BY o.datetime DESC, o.id DESC`,
        [userId]
    );

    return rows;
}

export type CancelResult =
    | {result: 'CANCELLED'; order: Order}
    | {result: 'NOT_FOUND'}
    | {result: 'NOT_CANCELLABLE'; status: string};

export async function getPositions(userId: number): Promise<RawPosition[]> {
    const {rows} = await pool.query<RawPosition>(
        `SELECT i.id AS "instrumentId",
            i.ticker,
            i.name,
            SUM(CASE WHEN o.side = 'BUY' THEN o.size ELSE -o.size END)::int AS quantity,
            (SUM(CASE WHEN o.side = 'BUY' THEN o.size * o.price ELSE 0 END)
               / NULLIF(SUM(CASE WHEN o.side = 'BUY' THEN o.size ELSE 0 END), 0))::float8
              AS "avgBuyPrice",
            md.close::float8 AS "lastPrice",
            md.previousclose::float8 AS "previousClose"
       FROM orders o
       JOIN instruments i ON i.id = o.instrumentid
       LEFT JOIN LATERAL (
              SELECT m.close, m.previousclose
                FROM marketdata m
               WHERE m.instrumentid = i.id
                 AND m.close IS NOT NULL
               ORDER BY m.date DESC
               LIMIT 1
            ) md ON true
      WHERE o.userid = $1
        AND o.status = 'FILLED'
        AND o.side IN ('BUY', 'SELL')
      GROUP BY i.id, i.ticker, i.name, md.close, md.previousclose
     HAVING SUM(CASE WHEN o.side = 'BUY' THEN o.size ELSE -o.size END) > 0
      ORDER BY i.ticker`,
        [userId]
    );

    return rows;
}

export async function getCashBalance(userId: number, db: Db = pool): Promise<number> {
    const {rows} = await db.query<{ cash: number }>(
        `SELECT COALESCE(SUM(
              CASE side
                WHEN 'CASH_IN'  THEN  size * price
                WHEN 'SELL'     THEN  size * price
                WHEN 'CASH_OUT' THEN -size * price
                WHEN 'BUY'      THEN -size * price
                ELSE 0
              END), 0)::float8 AS cash
       FROM orders
      WHERE userid = $1
        AND status = 'FILLED'`,
        [userId]
    );

    return rows[0].cash;
}

async function getPositionQuantity(userId: number, instrumentId: number, db: Db): Promise<number> {
    const {rows} = await db.query<{ quantity: number }>(
        `SELECT COALESCE(SUM(CASE WHEN side = 'BUY' THEN size ELSE -size END), 0)::int AS quantity
       FROM orders
      WHERE userid = $1
        AND instrumentid = $2
        AND status = 'FILLED'
        AND side IN ('BUY', 'SELL')`,
        [userId, instrumentId]
    );

    return rows[0].quantity;
}

async function getLastClose(instrumentId: number, db: Db): Promise<number | null> {
    const {rows} = await db.query<{ close: number | null }>(
        `SELECT close::float8 AS close
       FROM marketdata
      WHERE instrumentid = $1 AND close IS NOT NULL
      ORDER BY date DESC
      LIMIT 1`,
        [instrumentId]
    );

    return rows[0]?.close ?? null;
}

export async function createOrder(input: NewOrder): Promise<Order> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [input.userId]);

        let price: number | null;
        let size: number;
        let status: 'NEW' | 'FILLED' | 'REJECTED';

        if (input.side === 'CASH_IN' || input.side === 'CASH_OUT') {
            price = 1;
            size = input.size;
            status = 'FILLED';

            if (input.side === 'CASH_OUT') {
                const cash = await getCashBalance(input.userId, client);
                if (cash < size) status = 'REJECTED';
            }
        } else {
            price =
                input.type === 'MARKET'
                    ? await getLastClose(input.instrumentId, client)
                    : input.price ?? null;

            size =
                input.size ??
                (input.amount !== undefined && price !== null && price > 0
                    ? Math.floor(
                        Math.round(input.amount * 100) /
                        Math.round(price * 100)
                    )
                    : 0);

            status = input.type === 'MARKET' ? 'FILLED' : 'NEW';

            if (price === null || size <= 0) {
                status = 'REJECTED';
            } else if (input.side === 'BUY') {
                const cash = await getCashBalance(input.userId, client);
                if (cash < size * price) status = 'REJECTED';
            } else {
                const quantity = await getPositionQuantity(input.userId, input.instrumentId, client);
                if (quantity < size) status = 'REJECTED';
            }
        }

        const {rows} = await client.query<Order>(
            `INSERT INTO orders (instrumentid, userid, size, price, type, side, status, datetime)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                 RETURNING id,
                 instrumentid AS "instrumentId",
                 userid AS "userId",
                 size,
                 price::float8 AS price,
                 type, side, status, datetime`,
            [input.instrumentId, input.userId, size, price, input.type, input.side, status]
        );

        await client.query('COMMIT');

        return rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function cancelOrder(userId: number, orderId: number): Promise<CancelResult> {
    const {rows} = await pool.query<Order>(
        `UPDATE orders
        SET status = 'CANCELLED'
      WHERE id = $1
        AND userid = $2
        AND status = 'NEW'
      RETURNING id,
                instrumentid AS "instrumentId",
                userid AS "userId",
                size,
                price::float8 AS price,
                type, side, status, datetime`,
        [orderId, userId]
    );

    if (rows[0]) {
        return { result: 'CANCELLED', order: rows[0] };
    }

    const {rows: existing} = await pool.query<{ status: string }>(
        'SELECT status FROM orders WHERE id = $1 AND userid = $2',
        [orderId, userId]
    );

    return existing[0]
        ? {result: 'NOT_CANCELLABLE', status: existing[0].status}
        : {result: 'NOT_FOUND'};
}