import { createDatabase } from '../backend/src/database.ts';
import { migrate } from '../backend/src/migrate.ts';

if (!process.env.DATABASE_URL_UNPOOLED) {
  throw new Error(
    'DATABASE_URL_UNPOOLED is required for migrations. Add the direct Neon URL to .env.',
  );
}
const directUrl = new URL(process.env.DATABASE_URL_UNPOOLED);
if (directUrl.hostname.includes('-pooler.')) {
  throw new Error('Migrations require a direct Neon connection, without -pooler in the hostname.');
}
const database = createDatabase(process.env.DATABASE_URL_UNPOOLED);
try {
  const completed = await migrate(database);
  console.log(
    completed.length ? `Applied: ${completed.join(', ')}` : 'Database schema is up to date.',
  );
} finally {
  await database.close();
}
