import {readFileSync} from 'fs';
import {Client} from 'pg';

export default async function setup() {
    process.loadEnvFile('.env.test');
    const url = process.env.DATABASE_URL;

    if (!url || !new URL(url).pathname.endsWith('_test')) {
        throw new Error('test DATABASE_URL must point to base ended in "_test"');
    }

    const client = new Client({connectionString: url});
    await client.connect();
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query(readFileSync('database.sql', 'utf8'));
    await client.end();
}
