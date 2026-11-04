import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { createDatabase } from '../backend/src/database.js';
import { importLinks } from '../backend/src/import-links.js';

const sourcePath = resolve(process.argv[2] || process.env.DATA_FILE || 'data/links.sqlite');
const source = new DatabaseSync(sourcePath, { readOnly: true });
const database = createDatabase();
try {
  const rows = source.prepare('SELECT * FROM links ORDER BY rowid ASC').all();
  const result = await importLinks(database, rows);
  console.log(`Imported ${result.imported} links; verified all ${result.verified} source links.`);
  console.log('The original SQLite database was left unchanged.');
} finally {
  source.close();
  await database.close();
}
