import {Request, Response, NextFunction} from 'express';
import {ZodType} from 'zod';

interface Schemas {
    params?: ZodType;
    query?: ZodType;
    body?: ZodType;
}

export const validate = (schemas: Schemas) =>
    (req: Request, res: Response, next: NextFunction) => {
        if (schemas.params) {
            const result = schemas.params.safeParse(req.params);
            if (!result.success) {
                res.status(400).json({ error: 'Invalid params', details: result.error.issues });
                return;
            }
            res.locals.params = result.data;
        }

        if (schemas.query) {
            const result = schemas.query.safeParse(req.query);
            if (!result.success) {
                res.status(400).json({ error: 'Invalid query', details: result.error.issues });
                return;
            }
            res.locals.query = result.data;
        }

        if (schemas.body) {
            const result = schemas.body.safeParse(req.body);
            if (!result.success) {
                res.status(400).json({ error: 'Invalid body', details: result.error.issues });
                return;
            }
            res.locals.body = result.data;
        }

        next();
    };
