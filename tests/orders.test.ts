import {afterAll, beforeEach, describe, expect, it} from 'vitest';
import request from 'supertest';
import app from '../src/app';
import {pool} from '../src/db';

const SEED_ORDERS = 11;
const ARS = 66;
const STOCK = 47;
const LAST_CLOSE = 925.85;

const api = request(app);

const order = (userId: number, body: object) =>
    api.post(`/api/users/${userId}/orders`).send(body);

const cashIn = (userId: number, size: number) =>
    order(userId, {instrumentId: ARS, side: 'CASH_IN', type: 'MARKET', size});

const portfolio = (userId: number) => api.get(`/api/users/${userId}/portfolio`);

beforeEach(async () => {
    await pool.query('DELETE FROM orders WHERE id > $1', [SEED_ORDERS]);
});

afterAll(async () => {
    await pool.end();
});

describe('POST /users/:id/orders: MARKET', () => {
    it('realtime execution, FILLED, on last close', async () => {
        await cashIn(2, 100000);

        const res = await order(2, {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 10});

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
            userId: 2, instrumentId: STOCK, side: 'BUY', type: 'MARKET',
            size: 10, price: LAST_CLOSE, status: 'FILLED',
        });
    });

    it('portfolio retrieves daily return (close vs previousClose)', async () => {
        await cashIn(2, 100000);
        await order(2, { instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 10 });

        const res = await portfolio(2);

        expect(res.body.instruments[0].dailyReturnPct).toBeCloseTo(0.44, 2);
        expect(res.body.instruments[0].totalReturnPct).toBeCloseTo(0, 2);
    });

    it('with amount, calculates maximum stocks', async () => {
        await cashIn(2, 100000);

        const res = await order(2, {instrumentId: STOCK, side: 'BUY', type: 'MARKET', amount: 10000});

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({size: 10, status: 'FILLED'});
    });

    it('with amount lt stock price, rejects (size 0)', async () => {
        await cashIn(2, 100000);

        const res = await order(2, {instrumentId: STOCK, side: 'BUY', type: 'MARKET', amount: 1});

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({size: 0, status: 'REJECTED'});
    });

    it('updates portfolio balance and position', async () => {
        await cashIn(2, 100000);
        await order(2, {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 10});

        const res = await portfolio(2);

        expect(res.status).toBe(200);
        expect(res.body.availableCash).toBeCloseTo(100000 - 10 * LAST_CLOSE, 2);
        expect(res.body.instruments).toHaveLength(1);
        expect(res.body.instruments[0]).toMatchObject({instrumentId: STOCK, quantity: 10});
    });
});

describe('POST /users/:id/orders: LIMIT', () => {
    it('status NEW, with given price', async () => {
        await cashIn(2, 100000);

        const res = await order(2, {
            instrumentId: STOCK, side: 'BUY', type: 'LIMIT', size: 10, price: 900,
        });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ type: 'LIMIT', price: 900, size: 10, status: 'NEW' });
    });

    it('with amount, calculates size by given price', async () => {
        await cashIn(2, 100000);

        const res = await order(2, {
            instrumentId: STOCK, side: 'BUY', type: 'LIMIT', amount: 10000, price: 900,
        });

        expect(res.body).toMatchObject({size: 11, status: 'NEW'});
    });

    it('NEW order do not changes balance neither position', async () => {
        await cashIn(2, 100000);
        await order(2, {instrumentId: STOCK, side: 'BUY', type: 'LIMIT', size: 10, price: 900});

        const res = await portfolio(2);

        expect(res.body.availableCash).toBe(100000);
        expect(res.body.instruments).toHaveLength(0);
    });
});

describe('POST /users/:id/orders: rejections (stored as REJECTED)', () => {
    it('BUY without balance', async () => {
        const res = await order(3, {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 1});

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('REJECTED');

        const { rows } = await pool.query('SELECT status FROM orders WHERE id = $1', [res.body.id]);
        expect(rows[0].status).toBe('REJECTED');
    });

    it('SELL without stock', async () => {
        const res = await order(3, {instrumentId: STOCK, side: 'SELL', type: 'MARKET', size: 1});

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('REJECTED');
    });

    it('SELL gt position', async () => {
        await cashIn(2, 100000);
        await order(2, {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 10});

        const res = await order(2, {instrumentId: STOCK, side: 'SELL', type: 'MARKET', size: 11});

        expect(res.body.status).toBe('REJECTED');
    });

    it('SELL inside position becomes FILLED', async () => {
        await cashIn(2, 100000);
        await order(2, {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 10});

        const res = await order(2, {instrumentId: STOCK, side: 'SELL', type: 'MARKET', size: 5});

        expect(res.body.status).toBe('FILLED');
        const p = await portfolio(2);
        expect(p.body.instruments[0].quantity).toBe(5);
    });

    it('CASH_OUT gt balance', async () => {
        await cashIn(2, 1000);

        const res = await order(2, {
            instrumentId: ARS, side: 'CASH_OUT', type: 'MARKET', size: 5000,
        });

        expect(res.body.status).toBe('REJECTED');
    });

    it('simultaneous BUY do not get over balance', async () => {
        await cashIn(2, 10000);

        const [a, b] = await Promise.all([
            order(2, {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 6}),
            order(2, {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 6}),
        ]);

        const statuses = [a.body.status, b.body.status].sort();
        expect(statuses).toEqual(['FILLED', 'REJECTED']);
    });
});

describe('POST /users/:id/orders: CASH_IN / CASH_OUT', () => {
    it('CASH_IN is FILLED and raises balance', async () => {
        const res = await cashIn(2, 5000);

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ side: 'CASH_IN', type: 'MARKET', price: 1, status: 'FILLED' });

        expect((await portfolio(2)).body.availableCash).toBe(5000);
    });

    it('CASH_IN on stock returns 400', async () => {
        const res = await order(2, {instrumentId: STOCK, side: 'CASH_IN', type: 'MARKET', size: 100});
        expect(res.status).toBe(400);
    });

    it('BUY on cash returns 400', async () => {
        const res = await order(2, {instrumentId: ARS, side: 'BUY', type: 'MARKET', size: 100});
        expect(res.status).toBe(400);
    });
});

describe('POST /users/:id/orders: validation', () => {
    const invalid: Array<[string, object]> = [
        ['size and amount together', {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 1, amount: 1000}],
        ['neither size or amount', {instrumentId: STOCK, side: 'BUY', type: 'MARKET'}],
        ['LIMIT without price', {instrumentId: STOCK, side: 'BUY', type: 'LIMIT', size: 1}],
        ['invalid side', {instrumentId: STOCK, side: 'BUYING', type: 'MARKET', size: 1}],
        ['invalid type', {instrumentId: STOCK, side: 'BUY', type: 'STOP', size: 1}],
        ['negative size', {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: -5}],
        ['fraction size', {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 1.5}],
        ['CASH_IN without LIMIT', {instrumentId: ARS, side: 'CASH_IN', type: 'LIMIT', size: 100}],
        ['empty body', {}],
    ];

    it.each(invalid)('%s returns 400 and do not stores anything', async (_name, body) => {
        const res = await order(2, body);
        expect(res.status).toBe(400);
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM orders WHERE userid = 2');
        expect(rows[0].n).toBe(0);
    });

    it('user not found returns 404', async () => {
        const res = await order(999, {instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 1});
        expect(res.status).toBe(404);
    });

    it('instrument not found returns 404', async () => {
        const res = await order(2, {instrumentId: 9999, side: 'BUY', type: 'MARKET', size: 1});
        expect(res.status).toBe(404);
    });

    it('invalid user id returns 400', async () => {
        const res = await order('abc' as unknown as number, {
            instrumentId: STOCK, side: 'BUY', type: 'MARKET', size: 1,
        });
        expect(res.status).toBe(400);
    });
});
