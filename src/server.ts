import { buildApp } from "./app.js";
import { openDatabase } from "./db/client.js";

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DATABASE_PATH ?? "./data/scheduler.db";

const { db, close } = openDatabase(dbPath);
const app = await buildApp({ db, logger: { level: process.env.LOG_LEVEL ?? "info" } });

// Drain in-flight requests before closing the database on shutdown.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    close();
    process.exit(0);
  });
}

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  close();
  process.exit(1);
}
