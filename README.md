# Unified Service Scheduler

Backend service for **Keyloop Technical Assessment, Scenario A**. It books dealership service appointments, confirming one only when a **qualified technician** and a **service bay** are both free for the **entire** service duration, and stores a persistent appointment record that links the customer, vehicle, technician and bay.

- **System design:** [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) (architecture, data flow, technology choices, observability, assumptions)
- **API contract:** [docs/openapi.json](docs/openapi.json), also served live with Swagger UI at `http://localhost:3000/docs`
- **Stack:** Node.js · TypeScript · Fastify 5 · TypeBox · SQLite (better-sqlite3, WAL) · Drizzle ORM · prom-client · Vitest

## Quick start

### Option A: Docker (one command)

```bash
docker compose up --build    # http://localhost:3000  (Swagger UI at /docs)
```

The container compiles the TypeScript, runs as a non-root user, loads the demo data on first start (`SEED_DEMO_DATA=true`) and keeps the SQLite file in the named volume `scheduler-data`, so bookings survive restarts. A healthcheck polls `/ready`. Start from a clean database with `docker compose down -v`.

### Option B: Node.js

Requires **Node.js 22+** (developed on Node 25). No external database needed.

```bash
npm install
npm run seed          # creates ./data/scheduler.db with demo dealerships, technicians, bays, customers
npm start             # http://localhost:3000  (Swagger UI at /docs)
```

### Try it

With the server running (either option), in a second terminal:

```bash
npm run demo          # scripted cURL walkthrough of the booking flow (uses jq if installed)
```

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload |
| `npm test` | Run the full test suite |
| `npm run typecheck` | TypeScript type check |
| `npm run build` / `npm run start:prod` | Compile to `dist/` and run the compiled server (what the container runs) |
| `npm run openapi` | Regenerate `docs/openapi.json` from the route schemas |
| `npm run db:generate` | Generate a new SQL migration after editing `src/db/schema.ts` |

Configuration (environment variables): `PORT` (default `3000`), `DATABASE_PATH` (default `./data/scheduler.db`; `/data/scheduler.db` in the container), `LOG_LEVEL` (default `info`), `SEED_DEMO_DATA` (`true` loads demo data at start-up; safe to repeat). Migrations are applied automatically on start-up.

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
**400** invalid request · **404** unknown entity · **409** conflict (`NO_TECHNICIAN_AVAILABLE`, `NO_BAY_AVAILABLE`, `VEHICLE_ALREADY_BOOKED`, `APPOINTMENT_NOT_CANCELLABLE`) · **422** business-rule violation (`START_TIME_IN_PAST`, `BEYOND_BOOKING_HORIZON`, `OUTSIDE_OPERATING_HOURS`, `VEHICLE_NOT_OWNED_BY_CUSTOMER`, `NO_QUALIFIED_TECHNICIAN`, `IDEMPOTENCY_KEY_REUSED`).

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
test/                       unit, API integration, multi-process concurrency and query-plan tests
docs/                       System design document, OpenAPI spec
Dockerfile, docker-compose.yml, tsconfig.build.json   Container image and production build
CLAUDE.md                   Rules every Claude Code session loads (see AI Collaboration Narrative)
.claude/                    Hooks, test-runner subagent, skills, LESSONS.md, feature-map.md
```

## Testing

```bash
npm test
```

83 tests across five levels:

- **Domain unit tests** (`scheduling.test.ts`, `time.test.ts`): interval overlap edge cases (back-to-back is allowed, containment is not), opening-hours boundaries, timezone/DST conversion (London GMT/BST, Sydney across the date line), free-resource filtering and slot generation.
- **API integration tests** (`appointments.api.test.ts`): HTTP requests against a real in-memory SQLite database with a fixed injected clock. They cover every core requirement and every error code: qualified-technician assignment, bays exhausted while technicians are free, availability checked across the whole duration, vehicle double-booking, cancellation releasing resources, idempotent retries, and the availability endpoint agreeing with the booking endpoint.
- **Concurrency test** (`concurrency.test.ts`): four **separate OS processes** race to book the only EV technician through a shared database file. Exactly one wins.
- **Performance guard** (`query-plan.test.ts`): checks SQLite's query plan so the overlap query stays bounded and booking latency doesn't grow with history.
- **Ops tests** (`health.test.ts`): probes, metrics output, `x-request-id` propagation, OpenAPI served.

## AI Collaboration Narrative

> I built this with **Claude Code** (an agentic coding assistant in VS Code). The AI wrote most of the code and documents. I set the direction, made the product decisions, and approved every step before it was committed. Sentences marked **[CHECK]** are ones I still need to confirm before submitting.

### Strategy

**1. Decide first, then delegate.** I gave the AI the brief and my own scaffold (Fastify + TypeScript + Vitest). It inspected the repo before writing anything, which immediately caught a bug in my `tsconfig.json`. It then put the architecture-shaping choices to me as options with trade-offs. I chose SQLite + Drizzle over Postgres + Prisma (zero setup for reviewers), a transactional overlap check over slot locking (supports any duration), design doc and code together, and four scope extras (availability endpoint, OpenAPI, seed + cURL demo, metrics).

**2. After the first build, I took tighter control.** The first pass produced a lot in one go. I redirected the work to **one reviewable step at a time**: the AI finishes a step, summarises it, proposes the next, and stops for my review. I also told it to **ask me about ambiguity instead of assuming**, to **focus on the core** requirements rather than extras, and to run tests in a **subagent** so the main context stays small. The history from `2878080` onwards is that loop: one step per commit, committed only when I said so. The last two (`bf89a4d`, `1a69c3f`) I approved for commit with a review to follow. **[CHECK]** Remove this sentence once you've reviewed them.

**3. Product decisions are mine and written down.** The AI asked me two rounds of structured questions. My answers are decisions D1–D8 in the design doc (§1): a service advisor books, the system assigns technicians and bays, dealer-group scale targets, dealership-hours-only staffing, recovery targets, retention, a 90-day booking horizon and a single global deployment. For recovery, retention and deployment I deliberately chose the **simpler** option for the prototype, against the AI's recommendation. I then asked for its recommended production design to be written up with **measurable triggers for when to upgrade** (§5.5), so the trade-off is planned, not accidental.

**4. Shared conventions in the repo; personal progress out of it.** The AI suggested a `PROGRESS.md` to carry "where we left off" between sessions. I asked whether it would still work with more people on the project. It wouldn't (merge conflicts, a single "current step"), so progress stays in the AI's private memory, and everything that does carry over to a team is committed in `.claude/`.

### The AI workflow committed in this repo

| Piece | What it does | Why |
|---|---|---|
| `CLAUDE.md` | Core requirements (verbatim from the brief), architecture rules, frozen scope, how to work, which skill to use when | Every session, and every teammate's AI, starts with the same rules |
| Typecheck hook (`.claude/settings.json`) | After every `.ts` edit the project is type-checked and errors go straight back to the AI | Mistakes are caught at the edit, not at the end |
| SessionStart hook + `.claude/LESSONS.md` | Lessons from past mistakes are loaded into every new session | A **self-improvement loop**: a mistake made once is written down, not repeated |
| `test-runner` subagent | Runs typecheck and tests and returns only a short pass/fail summary | Keeps long test output out of the main conversation |
| Project skills: `verify`, `add-business-rule`, `retro` | Definition of done; red test → domain → service → docs; turning corrections into lessons | Repeatable process instead of ad-hoc prompting |
| Engineering skills (from `addyosmani/agent-skills`, provenance in `skills-lock.json`) | TDD, code review, simplification, git workflow, performance, ADRs and more, mapped to tasks in `CLAUDE.md` | I added the pack and asked for it to be wired into the workflow; heavier processes stay opt-in |
| `.claude/feature-map.md` | Each requirement and business rule → code → tests | A reviewer, or the AI, can find what proves each requirement |

The AI drafted these files. I added the brief's core requirements to `CLAUDE.md` word for word, so every session works from the exact acceptance criteria rather than a paraphrase. When auto mode blocked the AI from writing its own `settings.json` (it changes the AI's own behaviour), I created that file myself. The hooks were tested by piping sample input into them. **[CHECK]** Seeing them fire live in a session opened from this folder is still to be demonstrated.

### Verification: nothing counts until it has been seen to fail

- **Real database, real server.** 83 tests run against SQLite rather than mocks. Each step ended with the AI seeding a database, starting the server and running the cURL demo, then reporting the status codes, logs and metrics. **[CHECK]** Add whether you also watched these runs yourself.
- **Mutation testing.** For every test guarding something important, the AI broke the code on purpose and confirmed the test failed:
  - No transaction let **4 separate processes book the same technician**, which the race test catches.
  - Setting the query's lower bound to zero failed **9 tests**.
  - Removing the active-technician, active-bay, cross-dealership-vehicle and cancel-after-start checks each failed **exactly the one test** written for it. Before those tests existed, all four bugs would have passed the whole suite.
- **Measured, not assumed.** Before writing the non-functional section, the AI benchmarked bookings instead of trusting its own earlier claim of "about 1 ms". The real figure was **53 ms at 500k past appointments**, growing linearly, because the overlap query had no lower bound. One added condition made it flat (about 0.35 ms at any history size). A query-plan test now guards it.

### Corrections made during review

| Issue | How it was caught | Resolution |
|---|---|---|
| `tsconfig.json` `include` pointed at a non-existent path, so typecheck checked no source files | AI read the scaffold first | Fixed before feature work |
| Fastify silently stripped unknown fields, so a client's `technicianId` would be ignored with a 201 | A test failed | Config changed to reject unknown fields (400); the test was kept, not weakened |
| The first concurrency test could never fail (better-sqlite3 is synchronous) | Review of the test itself | Replaced by a multi-process race test, then mutation-tested |
| The AI's backup copy during mutation testing failed silently, leaving broken code in place | Command output | Reverted by hand and re-tested. Lesson: back up with git, not temp copies |
| Design doc claimed "about 1 ms per booking" without measuring | Benchmark | Real cause found and fixed (see above) |
| Several AI-written doc claims weren't true (e.g. logs "include booking times") | AI rereading its own diff before review | Corrected before commit |
| Four gaps where core behaviour had no test | Step 3 scope review against the feature map | Tests added and mutation-checked; dead code removed |
| An earlier draft of **this narrative** credited me with choices the AI had made (timezones, layering, running the mutation tests) | Final consistency pass | Rewritten from git history and the session record |

### Ownership

**[CHECK]** I chose the stack, scope and every product decision (D1–D8), and approved each step before it was committed. The AI's speed went into code, test breadth and drafts. My review went into the decisions and the trade-offs. **[CHECK]** I can explain the booking transaction, the overlap rule and the timezone handling without the AI.

**[CHECK]** Still to do before submission: run `docker compose up --build` (the container setup is verified only outside Docker so far) and demonstrate the hooks firing live.

## Known limitations

See design doc §1 (assumptions) and §10 (future work). In short: no authentication, single opening window per day (no shifts, breaks or holidays), all bays can host every service, first-fit allocation, and SQLite's single writer (the PostgreSQL migration path with exclusion constraints is documented in §5.2).
