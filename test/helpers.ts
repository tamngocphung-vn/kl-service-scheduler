import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";

// Sunday 1 Nov 2026, 00:00 UTC. London is on GMT (UTC+0), Sydney on AEDT (UTC+11).
export const NOW = Date.parse("2026-11-01T00:00:00Z");
export const MONDAY = "2026-11-02";

export async function createTestApp(now = NOW) {
  const { db, close } = openDatabase(":memory:");
  seed(db);
  const app = await buildApp({ db, now: () => now });
  return {
    app,
    db,
    async close() {
      await app.close();
      close();
    },
  };
}

export const booking = (overrides: Record<string, unknown> = {}) => ({
  dealershipId: "dlr-london",
  customerId: "cust-jane",
  vehicleId: "veh-jane-golf",
  serviceTypeId: "svc-oil",
  startTime: `${MONDAY}T09:00:00Z`,
  ...overrides,
});

// Convenience vehicles owned by different customers, for filling up resources.
export const RAJ = { customerId: "cust-raj", vehicleId: "veh-raj-civic" };
export const MARIA = { customerId: "cust-maria", vehicleId: "veh-maria-model3" };
export const JANE_LEAF = { customerId: "cust-jane", vehicleId: "veh-jane-leaf" };
