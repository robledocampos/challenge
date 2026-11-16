import {z} from 'zod';

const optionalText = z
    .string()
    .trim()
    .max(100)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

export const listInstrumentsQuery = z.object({
    ticker: optionalText,
    name: optionalText,
});

export type ListInstrumentsQuery = z.infer<typeof listInstrumentsQuery>;
