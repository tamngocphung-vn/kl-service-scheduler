import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";
import { appointments } from "../src/db/schema.js";

const run = promisify(execFile);
const WORKER = join(import.meta.dirname, "fixtures/book-worker.ts");

// Separate OS processes sharing one database file: this exercises SQLite's write lock, which the
// in-process API test cannot (better-sqlite3 is synchronous, so in-process requests never interleave).
describe("cross-process booking race", () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "scheduler-race-"));
    dbPath = join(dir, "race.db");
    const { db, close } = openDatabase(dbPath);
    seed(db);
    close();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("never double-books the only qualified technician", async () => {
    const contenders = [
      ["cust-jane", "veh-jane-leaf"],
      ["cust-jane", "veh-jane-golf"],
      ["cust-raj", "veh-raj-civic"],
      ["cust-maria", "veh-maria-model3"],
    ];
    // Give every process time to boot (tsx + migrations) before the shared start instant.
    const goAt = Date.now() + 2500;

    const outputs = await Promise.all(
      contenders.map(([customerId, vehicleId]) =>
        run(process.execPath, ["--import", "tsx", WORKER, dbPath, customerId, vehicleId, "2026-11-02T09:00:00Z", String(goAt)]),
      ),
    );
    const results = outputs.map((o) => JSON.parse(o.stdout.trim()));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => r.code)).toEqual(
      Array(contenders.length - 1).fill("NO_TECHNICIAN_AVAILABLE"),
    );

    const { db, close } = openDatabase(dbPath);
    expect(db.select().from(appointments).all()).toHaveLength(1);
    close();
  }, 20_000);
});
