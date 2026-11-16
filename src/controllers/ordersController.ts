import {z} from 'zod';
import {Request, Response} from 'express';
import {findInstrumentById} from '../repositories/instrumentsRepository';
import {findUserById} from '../repositories/usersRepository';
import {
    getCashBalance,
    getPositions,
    createOrder as insertOrder,
    cancelOrder as updateOrderToCancelled,
    listOrders as findOrdersByUser
} from '../repositories/ordersRepository';
import {userParams, orderParams, CreateOrderBody} from '../schemas/users';

type UserParams = z.infer<typeof userParams>;
type OrderParams = z.infer<typeof orderParams>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function portfolio(req: Request, res: Response) {
    const {id: userId} = res.locals.params as UserParams;

    try {
        const user = await findUserById(userId);

        if (!user) {
            res.status(404).json({error: 'User not found'});
            return;
        }

        const [cash, positions] = await Promise.all([
            getCashBalance(userId),
            getPositions(userId),
        ]);

        const instruments = positions.map((p) => {
            const price = p.lastPrice ?? p.avgBuyPrice;

            const dailyReturnPct =
                p.lastPrice !== null && p.previousClose !== null && p.previousClose > 0
                    ? round2(((p.lastPrice - p.previousClose) / p.previousClose) * 100)
                    : null;

            return {
                instrumentId: p.instrumentId,
                ticker: p.ticker,
                name: p.name,
                quantity: p.quantity,
                lastPrice: p.lastPrice,
                totalValue: round2(p.quantity * price),
                dailyReturnPct,
                totalReturnPct: round2(((price - p.avgBuyPrice) / p.avgBuyPrice) * 100),
            };
        });

        const positionsValue = instruments.reduce((sum, a) => sum + a.totalValue, 0);

        res.json({
            userId,
            totalAccountValue: round2(cash + positionsValue),
            availableCash: round2(cash),
            instruments
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({error: 'Internal error'});
    }
}

export async function listOrders(req: Request, res: Response) {
    const {id: userId} = res.locals.params as UserParams;

    try {
        const user = await findUserById(userId);

        if (!user) {
            res.status(404).json({error: 'User not found'});
            return;
        }

        res.json(await findOrdersByUser(userId));
    } catch (err) {
        console.error(err);
        res.status(500).json({error: 'Internal error'});
    }
}

export async function createOrder(req: Request, res: Response) {
    const {id: userId} = res.locals.params as UserParams;
    const body = res.locals.body as CreateOrderBody;

    const isCash = body.side === 'CASH_IN' || body.side === 'CASH_OUT';

    try {
        const user = await findUserById(userId);

        if (!user) {
            res.status(404).json({error: 'User not found'});
            return;
        }

        const instrument = await findInstrumentById(body.instrumentId);

        if (!instrument) {
            res.status(404).json({error: 'Instrument not found'});
            return;
        }
        if (isCash && instrument.type !== 'MONEDA') {
            res.status(400).json({error: 'CASH_IN and CASH_OUT only apply to MONEDA instruments'});
            return;
        }
        if (!isCash && instrument.type === 'MONEDA') {
            res.status(400).json({error: 'Currencies cannot be traded with BUY/SELL'});
            return;
        }

        const order = await insertOrder({
            userId,
            ...body
        });

        res.status(201).json(order);
    } catch (err) {
        console.error(err);
        res.status(500).json({error: 'Internal error'});
    }
}

export async function cancelOrder(req: Request, res: Response) {
    const {id: userId, orderId} = res.locals.params as OrderParams;

    try {
        const outcome = await updateOrderToCancelled(userId, orderId);

        switch (outcome.result) {
            case 'CANCELLED':
                res.json(outcome.order);
                return;
            case 'NOT_CANCELLABLE':
                res.status(409).json({
                    error: `Only NEW orders can be cancelled (current status: ${outcome.status})`,
                });
                return;
            case 'NOT_FOUND':
                res.status(404).json({error: 'Order not found'});
                return;
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({error: 'Internal error'});
    }
}
