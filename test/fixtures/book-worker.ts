// Child process used by concurrency.test.ts: opens the shared database file, waits for a common
// start instant so all workers race, attempts one booking and prints the outcome as JSON.
import { openDatabase } from "../../src/db/client.js";
import { AppError } from "../../src/domain/errors.js";
import { SchedulingService } from "../../src/services/scheduling-service.js";

const [dbPath, customerId, vehicleId, startTime, goAt] = process.argv.slice(2);

const { db, close } = openDatabase(dbPath);
const service = new SchedulingService(db, { now: () => Date.parse("2026-11-01T00:00:00Z") });

while (Date.now() < Number(goAt)) {
  // busy-wait so every worker leaves the barrier within the same millisecond
}

try {
  const { appointment } = service.book({
    dealershipId: "dlr-london",
    customerId,
    vehicleId,
    serviceTypeId: "svc-ev",
    startTime,
  });
  console.log(JSON.stringify({ ok: true, id: appointment.id }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, code: err instanceof AppError ? err.code : String(err) }));
} finally {
  close();
}
