import {pool} from '../db';

export interface User {
    id: number;
    email: string;
    accountNumber: string;
}

export async function findAllUsers(): Promise<User[]> {
    const {rows} = await pool.query<User>(
        'SELECT id, email, accountnumber AS "accountNumber" FROM users ORDER BY id'
    );
    return rows;
}

export async function findUserById(id: number): Promise<User | null> {
    const {rows} = await pool.query<User>(
        'SELECT id, email, accountnumber AS "accountNumber" FROM users WHERE id = $1',
        [id]
    );
    return rows[0] ?? null;
}


