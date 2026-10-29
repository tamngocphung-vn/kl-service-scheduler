import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type DbHandle } from "../src/db/client.js";
import { busyBlocksQuery } from "../src/services/scheduling-service.js";

// Performance guard: the overlap query must bound starts_at on BOTH sides. With only an upper
// bound, SQLite scans every past appointment at the dealership and booking latency grows with
// history (measured: 0.4 ms with no history vs 53 ms at 500k rows; see SYSTEM_DESIGN §5.0).
let handle: DbHandle;

beforeEach(() => {
  handle = openDatabase(":memory:");
});
afterEach(() => handle.close());

function planFor(vehicleId?: string): string[] {
  const window = { start: Date.parse("2026-11-02T09:00:00Z"), end: Date.parse("2026-11-02T10:00:00Z") };
  const { sql, params } = busyBlocksQuery(handle.db, window, "dlr-london", vehicleId).toSQL();
  const rows = handle.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
  return rows.map((r) => r.detail).filter((d) => d.startsWith("SEARCH") || d.startsWith("SCAN"));
}

describe("busy-blocks query plan", () => {
  it.each([
    ["dealership only (availability)", undefined],
    ["dealership or vehicle (booking)", "veh-jane-golf"],
  ])("uses an index range bounded on both sides: %s", (_label, vehicleId) => {
    const plan = planFor(vehicleId);
    expect(plan.length).toBeGreaterThan(0);
    for (const step of plan) {
      expect(step).not.toMatch(/^SCAN/);
      expect(step).toMatch(/starts_at>\? AND starts_at<\?/);
    }
  });
});
