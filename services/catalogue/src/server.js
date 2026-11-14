import { app } from './app.js';
const server = app.listen(Number(process.env.PORT || 3002), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  setTimeout(() => process.exit(1), 8000).unref();
  server.close(() => process.exit(0));
});
