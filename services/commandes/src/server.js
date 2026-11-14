import { app } from "./app.js";
import { pool } from "./database.js";

const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "service_started",
      port: Number(process.env.PORT || 3000),
    }),
  );
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 8000);
  timeout.unref();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
