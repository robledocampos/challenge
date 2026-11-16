import {Request, Response} from 'express';
import {searchInstruments} from '../repositories/instrumentsRepository';
import {ListInstrumentsQuery} from '../schemas/instruments';

export async function list(req: Request, res: Response) {
    const { ticker, name } = res.locals.query as ListInstrumentsQuery;

    try {
        res.json(await searchInstruments({ ticker, name }));
    } catch (err) {
        console.error(err);
        res.status(500).json({error: 'Internal error'});
    }
}
