# Feature map

Maps each requirement to the code that implements it and the tests that prove it. Keep it current: the `add-business-rule` and `verify` skills update it.

## Core requirements (Scenario A)

| # | Requirement | Code | Tests |
|---|---|---|---|
| R1 | Request an appointment for a vehicle, service type, dealership and time | `POST /v1/appointments` in `src/routes/v1/appointments.ts` → `SchedulingService.book()` in `src/services/scheduling-service.ts` | `test/appointments.api.test.ts` › "successful booking", "validation" |
| R2 | Check a **qualified technician** and a **bay** are both free for the **whole duration** | `candidates()` + `busyBlocks()` in the service; `findFreeResources()`, `overlaps()` in `src/domain/scheduling.ts`; run inside `BEGIN IMMEDIATE` | `test/scheduling.test.ts` › overlaps, findFreeResources; `appointments.api.test.ts` › "resource availability"; `test/concurrency.test.ts` |
| R3 | Persist an appointment linking customer, vehicle, technician and bay | `appointments` table in `src/db/schema.ts`; insert in `book()` | `appointments.api.test.ts` › "persists the appointment so it can be read back" |

## Business rules

| Rule | Code | Error code | Tests |
|---|---|---|---|
| Technician must be qualified for the service type | `candidates()` join on `technician_qualifications` | `NO_QUALIFIED_TECHNICIAN` (422) | api › "only assigns a technician qualified…", "rejects a service no technician…" |
| No overlapping appointment for the technician | `findFreeResources()` | `NO_TECHNICIAN_AVAILABLE` (409) | api › "every qualified technician is busy", "checks the entire service duration" |
| No overlapping appointment for the bay | `findFreeResources()` | `NO_BAY_AVAILABLE` (409) | api › "every bay is occupied" |
| Vehicle can't be in two appointments at once, at any dealership (A7) | `isVehicleBusy()`; vehicle branch of `busyBlocksQuery()` | `VEHICLE_ALREADY_BOOKED` (409) | api › "prevents the same vehicle…", "…at two dealerships at overlapping times" |
| Inactive technicians and bays are never assigned | `isActive` filters in `candidates()` | `NO_QUALIFIED_TECHNICIAN` / `NO_BAY_AVAILABLE` | api › "never assigns an inactive technician", "…inactive bay" |
| Back-to-back appointments allowed (half-open intervals) | `overlaps()` | none | domain › "treats back-to-back…"; api › "allows back-to-back…" |
| Within dealership opening hours, in its own timezone | `isWithinOperatingHours()`, `src/domain/time.ts` | `OUTSIDE_OPERATING_HOURS` (422) | domain › isWithinOperatingHours; time.test.ts; api › Sydney case |
| Start time must be in the future | `book()` | `START_TIME_IN_PAST` (422) | api › "rejects start times in the past" |
| At most 90 days ahead (D7) | `isWithinBookingHorizon()`; `notAfter` in `computeAvailableSlots()` | `BEYOND_BOOKING_HORIZON` (422) | domain › isWithinBookingHorizon, "excludes slots starting after notAfter"; api › "…90-day horizon" (3 tests) |
| Overlap query bounded on both sides (performance) | `busyBlocksQuery()` + `MAX_APPOINTMENT_MS` | none | `test/query-plan.test.ts` |
| Vehicle must belong to the customer | `book()` | `VEHICLE_NOT_OWNED_BY_CUSTOMER` (422) | api › "rejects a vehicle that does not belong…" |
| Unknown request fields rejected | `ajv.customOptions.removeAdditional: false` in `src/app.ts` | `VALIDATION_ERROR` (400) | api › "returns 400 for a unknown field" |
| Allocation: first free in stable ID order | `book()` picks `[0]` | none | api › "allocates a different technician when the first is busy" |

## Supporting features

| Feature | Code | Tests |
|---|---|---|
| Availability slots | `availability()` + `computeAvailableSlots()` | domain › computeAvailableSlots; api › "GET …/availability" |
| Cancellation releases resources; started appointments can't be cancelled | `cancel()` | api › "frees the technician and bay…", "cancellation" (incl. `APPOINTMENT_NOT_CANCELLABLE`) |
| Idempotent retries | `replay()` + unique index on `idempotency_key` | api › "Idempotency-Key" |
| Observability | `src/observability/metrics.ts`, hooks in `src/app.ts` | `test/health.test.ts` |
| Tracing (D11): `appointment.book` span, `trace_id` on log lines, no customer or vehicle IDs on spans | `src/observability/trace.ts`, `tracing.ts`; span in `src/routes/v1/appointments.ts`; log mixin in `src/app.ts` | `test/tracing.test.ts` |
