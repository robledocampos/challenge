import {z} from 'zod';

const PG_INT_MAX = 2_147_483_647;

export const idParam = z
    .string()
    .regex(/^\d+$/, 'Must be integer')
    .transform(Number)
    .pipe(z.number().int().positive().max(PG_INT_MAX));

export const positiveInt = z.number().int().positive().max(PG_INT_MAX);
