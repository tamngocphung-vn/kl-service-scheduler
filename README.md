# Unified Service Scheduler

Backend service for **Keyloop Technical Assessment, Scenario A**. It books dealership service appointments, confirming one only when a **qualified technician** and a **service bay** are both free for the **entire** service duration, and stores a persistent appointment record that links the customer, vehicle, technician and bay.

- **System design:** [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) (architecture, data flow, technology choices, observability, assumptions)
- **API contract:** [docs/openapi.json](docs/openapi.json), also served live with Swagger UI at `http://localhost:3000/docs`
- **Stack:** Node.js · TypeScript · Fastify 5 · TypeBox · SQLite (better-sqlite3, WAL) · Drizzle ORM · prom-client · Vitest

## Quick start

Requires **Node.js 22+** (developed on Node 25). No Docker or external database needed.

```bash
npm install
npm run seed          # creates ./data/scheduler.db with demo dealerships, technicians, bays, customers
npm start             # http://localhost:3000  (Swagger UI at /docs)
```

In a second terminal:

```bash
npm run demo          # scripted cURL walkthrough of the booking flow (uses jq if installed)
```

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload |
| `npm test` | Run the full test suite |
| `npm run typecheck` | TypeScript type check |
| `npm run openapi` | Regenerate `docs/openapi.json` from the route schemas |
| `npm run db:generate` | Generate a new SQL migration after editing `src/db/schema.ts` |

Configuration (environment variables): `PORT` (default `3000`), `DATABASE_PATH` (default `./data/scheduler.db`), `LOG_LEVEL` (default `info`). Migrations are applied automatically on start-up.

## Using the API

Seed data: dealership `dlr-london` (Europe/London, 08:00–18:00, bays `bay-ldn-1` and `bay-ldn-2`) with technicians Alice (oil, brakes, MOT), Bob (oil, MOT) and Chen (EV, brakes). The only EV-qualified technician is Chen. A second dealership, `dlr-sydney`, exercises timezone handling.

```bash
# Where can I fit a 90-minute EV battery check on Monday?
curl "localhost:3000/v1/dealerships/dlr-london/availability?serviceTypeId=svc-ev&date=2026-11-02"

# Book it (the system assigns the technician and bay)
curl -X POST localhost:3000/v1/appointments \
  -H 'content-type: application/json' -H 'idempotency-key: 7f1c-retry-safe' \
  -d '{"dealershipId":"dlr-london","customerId":"cust-jane","vehicleId":"veh-jane-leaf",
       "serviceTypeId":"svc-ev","startTime":"2026-11-02T09:00:00Z"}'
# → 201 {"id":"…","status":"CONFIRMED","technicianId":"tech-ldn-chen","serviceBayId":"bay-ldn-1",
#        "startTime":"2026-11-02T09:00:00.000Z","endTime":"2026-11-02T10:30:00.000Z", …}

# Someone else wants Chen at 09:30 → 409 NO_TECHNICIAN_AVAILABLE
# Retry the first request with the same Idempotency-Key → 200 with the same appointment, no duplicate

curl "localhost:3000/v1/dealerships/dlr-london/appointments?date=2026-11-02"   # day schedule
curl -X POST localhost:3000/v1/appointments/<id>/cancel                       # frees Chen + the bay
curl localhost:3000/metrics | grep appointment_booking                        # outcome counters
```

| Endpoint | Purpose |
|---|---|
| `POST /v1/appointments` | Book (requirements 1–3). 201 new · 200 idempotent replay |
| `GET /v1/appointments/{id}` | Fetch an appointment |
| `POST /v1/appointments/{id}/cancel` | Cancel (idempotent), releasing technician and bay |
| `GET /v1/dealerships/{id}/availability?serviceTypeId=&date=` | Bookable start times on a 15-minute grid |
| `GET /v1/dealerships/{id}/appointments?date=` | Day schedule |
| `GET /v1/dealerships`, `GET /v1/service-types` | Reference data |
| `GET /health`, `GET /ready`, `GET /metrics`, `GET /docs` | Liveness, readiness (DB), Prometheus, Swagger UI |

Errors share one envelope: `{"error": {"code", "message", "details?", "requestId"}}`.
**400** invalid request · **404** unknown entity · **409** resource conflict (`NO_TECHNICIAN_AVAILABLE`, `NO_BAY_AVAILABLE`, `VEHICLE_ALREADY_BOOKED`) · **422** business-rule violation (`START_TIME_IN_PAST`, `OUTSIDE_OPERATING_HOURS`, `VEHICLE_NOT_OWNED_BY_CUSTOMER`, `NO_QUALIFIED_TECHNICIAN`, `IDEMPOTENCY_KEY_REUSED`).

## Project structure

```
src/
  app.ts                    Fastify app: hooks, error envelope, swagger, ops endpoints, /v1 routes
  server.ts                 Process entry: open DB, listen, graceful shutdown
  domain/                   Pure business rules (no I/O)
    scheduling.ts             overlap, opening hours, free-resource search, slot generation
    time.ts                   IANA timezone ↔ UTC conversion (DST-safe, via Intl)
    errors.ts                 AppError + stable error codes
  services/scheduling-service.ts   Use cases; atomic check-and-book transaction; idempotency
  routes/                   HTTP routes + TypeBox schemas (validation, types and OpenAPI from one source)
  db/                       Drizzle schema, connection + migrations, seed data
  observability/metrics.ts  Prometheus metrics
drizzle/                    Versioned SQL migrations
scripts/                    seed, demo (cURL), OpenAPI export
test/                       unit, API integration, multi-process concurrency tests
docs/                       System design document, OpenAPI spec
```

## Testing

```bash
npm test
```

71 tests across four levels:

- **Domain unit tests** (`scheduling.test.ts`, `time.test.ts`): interval overlap edge cases (back-to-back is allowed, containment is not), opening-hours boundaries, timezone/DST conversion (London GMT/BST, Sydney across the date line), free-resource filtering and slot generation.
- **API integration tests** (`appointments.api.test.ts`): HTTP requests against a real in-memory SQLite database with a fixed injected clock. They cover every core requirement and every error code: qualified-technician assignment, bays exhausted while technicians are free, availability checked across the whole duration, vehicle double-booking, cancellation releasing resources, idempotent retries, and the availability endpoint agreeing with the booking endpoint.
- **Concurrency test** (`concurrency.test.ts`): four **separate OS processes** race to book the only EV technician through a shared database file. Exactly one wins.
- **Ops tests** (`health.test.ts`): probes, metrics output, `x-request-id` propagation, OpenAPI served.

## AI Collaboration Narrative

> I built this with **Claude Code** (an agentic coding assistant in VS Code) as the implementer. I acted as architect and reviewer.

### Strategy: decide first, then delegate

I didn't ask the AI to "build a scheduler". I started from my own scaffold (Fastify + TypeScript + Vitest), gave it the full brief, and had it **inspect the repo before writing anything**. It then put the decisions that shape the architecture in front of me as explicit options with trade-offs: database (SQLite + Drizzle vs Postgres + Prisma), concurrency control (transactional overlap check vs slot locking), sequencing (doc first vs code first), and scope extras. I made those calls, and the AI implemented against them. I also had it state every ambiguity in the brief as a written assumption (design doc §1) so I could accept or overrule each one. For example, I chose dealership-local timezones over "assume UTC".

I asked for a deliberate layering that makes the AI's output easy to verify: **pure domain functions** (no I/O, unit-testable) → a **service** that owns transactions → **thin routes** whose TypeBox schemas generate validation, types *and* the OpenAPI doc. Review effort could then go to ~150 lines of business rules rather than the whole codebase.

### Verification: trust nothing that hasn't been seen to fail

- **Type check + full test run after every change.** 71 tests, against a real SQLite database rather than mocks.
- **Ran the real thing.** I seeded a database, started the server, and ran the cURL demo end to end. I checked the status codes, the assigned technicians and bays, the structured log lines and the metric counters by eye.
- **Caught a test that couldn't fail.** The first concurrency test fired parallel HTTP requests in one process. On review, the AI and I recognised it was meaningless: better-sqlite3 is synchronous, so those requests never interleave, and the test would pass even with no transaction. We replaced it with a **multi-process race test**.
- **Mutation-tested the critical guarantee.** To prove the new test actually guards against double-booking, I had the AI temporarily break the code two ways. A *deferred* transaction made the test fail with `SQLITE_BUSY` errors. *No transaction* let **all four processes book the same technician**. The code was then restored and the suite re-run green.

### Corrections made during review

| Issue found | Resolution |
|---|---|
| My scaffold's `tsconfig.json` `include` pointed at a non-existent path, so `typecheck` silently checked no source files | Fixed before any feature work |
| Fastify's default Ajv config **silently strips** unknown fields, so a client sending `technicianId` would get a 201 and believe its choice was honoured (surfaced by a failing test) | Changed config to **reject** unknown fields (400) instead of weakening the test |
| A test written to cover "checks the whole duration" set up a confusing four-booking scenario that was hard to verify by reading | Rewritten as two clear boundary cases (starts during / runs into an existing booking) |
| Date regex accepted impossible dates like `2026-02-30`, which `Date.UTC` would silently roll over | Added real calendar validation and a test |
| Demo script's output helper was over-engineered and broke under `set -o pipefail` | Simplified and re-run against the live server |
| During mutation testing, the AI's backup copy of the source file failed (wrong temp directory), leaving the mutated code in place | Caught from the command output and reverted by hand. Grepped to confirm no mutation remained, then re-ran all tests. This is a reminder to verify the AI's housekeeping steps, not just its code. |

### Ownership

Every design decision in this repo is one I made or explicitly accepted, and I can explain each line of the domain and service layers. The AI's speed went into boilerplate, test breadth and documentation drafts. My time went into the parts where a mistake costs real money: the concurrency guarantee, the time maths and the API contract.

## Known limitations

See design doc §1 (assumptions) and §10 (future work). In short: no authentication, single opening window per day (no shifts, breaks or holidays), all bays can host every service, first-fit allocation, and SQLite's single writer (the PostgreSQL migration path with exclusion constraints is documented in §5.2).
