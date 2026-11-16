import app from './app';
import {pool} from './db';

const PORT = Number(process.env.PORT ?? 3000);

pool.query('SELECT NOW()')
    .then(() => console.log('Database connected successfully.'))
    .catch((err) => console.error('Database error:', err.message));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});