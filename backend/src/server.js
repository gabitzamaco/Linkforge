import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const host = process.env.HOST || '127.0.0.1';
const app = createApp();
const server = app.listen(port, host, () => {
  console.log(`Linkforge is running at http://${host}:${port}`);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    app.locals.store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

server.on('error', (error) => {
  console.error(`Could not start Linkforge: ${error.message}`);
  app.locals.store.close();
  process.exitCode = 1;
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
