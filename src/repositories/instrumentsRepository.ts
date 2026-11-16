import {pool} from '../db';

export interface Instrument {
    id: number;
    ticker: string;
    name: string;
    type: string;
}

export interface InstrumentSearch {
    ticker?: string;
    name?: string;
}

export async function findInstrumentById(id: number): Promise<Instrument | null> {
    const { rows } = await pool.query<Instrument>(
        'SELECT id, ticker, name, type FROM instruments WHERE id = $1',
        [id]
    );
    return rows[0] ?? null;
}

export async function searchInstruments({ticker, name}: InstrumentSearch): Promise<Instrument[]> {
    const {rows} = await pool.query<Instrument>(
        `SELECT id, ticker, name, type
            FROM instruments
            WHERE ($1::text IS NULL OR ticker ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%')
            ORDER BY ticker
            LIMIT 100`,
        [ticker ?? null, name ?? null]
    );
    return rows;
}
