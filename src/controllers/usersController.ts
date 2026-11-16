import {z} from 'zod';
import {Request, Response} from 'express';
import {findAllUsers, findUserById} from '../repositories/usersRepository';
import {userParams} from '../schemas/users';

type UserParams = z.infer<typeof userParams>;

export async function list(req: Request, res: Response) {
    try {
        res.json(await findAllUsers());
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal error' });
    }
}

export async function getById(req: Request, res: Response) {
    const {id} = res.locals.params as UserParams;

    try {
        const user = await findUserById(id);

        if (!user) {
            res.status(404).json({error: 'User not found'});
            return;
        }
        res.json(user);
    } catch (err) {
        console.error(err);
        res.status(500).json({error: 'Internal error'});
    }
}
