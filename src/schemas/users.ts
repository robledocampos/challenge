import {z} from 'zod';
import {idParam, positiveInt} from './common';

export const userParams = z.object({id: idParam});

export const orderParams = z.object({id: idParam, orderId: idParam});

const tradeBase = {
    side: z.enum(['BUY', 'SELL']),
    instrumentId: positiveInt,
    size: positiveInt.optional(),
    amount: z.number().positive().lt(1e8).optional()
};

const exactlyOne = (b: {size?: number; amount?: number}) =>
    (b.size === undefined) !== (b.amount === undefined);

const exactlyOneError = {
    message: "Provide either 'size' or 'amount', but not both",
    path: ['size'],
};

const marketOrder = z
    .object({...tradeBase, type: z.literal('MARKET')})
    .refine(exactlyOne, exactlyOneError);

const limitOrder = z
    .object({
        ...tradeBase,
        type: z.literal('LIMIT'),
        price: z.number().positive().lt(1e8),
    })
    .refine(exactlyOne, exactlyOneError);

const cashOrder = z.object({
    side: z.enum(['CASH_IN', 'CASH_OUT']),
    type: z.literal('MARKET'),
    instrumentId: positiveInt,
    size: positiveInt,
});

export const createOrderBody = z.union([marketOrder, limitOrder, cashOrder]);

export type CreateOrderBody = z.infer<typeof createOrderBody>;
