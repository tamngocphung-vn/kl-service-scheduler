# Unified Service Scheduler

Backend for **Keyloop Technical Assessment, Scenario A**. It books a dealership service appointment only when a **qualified technician** and a **service bay** are both free for the **entire** duration, and stores an appointment linking customer, vehicle, technician and bay.

| Read | For |
|---|---|
| [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) | Requirements incl. non-functional (§1.2), architecture, components, data flow, technologies, observability, GenAI in design, API and errors (§8.2), future work |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Product decisions D1–D13 and assumptions |
| [docs/BUILD_FOR_THE_FUTURE.md](docs/BUILD_FOR_THE_FUTURE.md) | Scalability, performance, reliability, maintainability, observability; upgrade triggers, security and privacy, testing (§4.1) |
| [docs/openapi.json](docs/openapi.json) or `/docs` on a running server | Full API contract (Swagger UI) |
| [CHANGELOG.md](CHANGELOG.md) | What each release contains, and the versioning policy |

**Stack:** Node.js · TypeScript · Fastify 5 · TypeBox · SQLite (better-sqlite3, WAL) · Drizzle ORM · prom-client · Vitest

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [Quick start](#quick-start)
- [API overview](#api-overview)
  - [Check availability](#check-availability)
  - [Book an appointment](#book-an-appointment)
  - [Cancel an appointment](#cancel-an-appointment)
- [Project structure](#project-structure)
- [Build for the future](#build-for-the-future)
- [AI Collaboration Narrative](#ai-collaboration-narrative)
  - [Working principles](#working-principles)
  - [Future: multi-agent development model](#future-multi-agent-development-model)
- [Future improvements](#future-improvements)

<!-- END doctoc -->

## Quick start

```bash
# Option A: Docker (pre-prod profile: demo data loaded)
docker compose up --build                  # http://localhost:3000; `down -v` resets it
APP_ENV=prod docker compose up --build     # prod profile: empty database

# Option B: Node.js 22+ (dev profile: demo data, no external database)
npm install && npm start

# Then, in a second terminal
npm run demo                     # scripted cURL walkthrough of the booking flow
```

Other commands: `npm test` · `npm run dev` (auto-reload) · `npm run typecheck` · `npm run build && npm run start:prod` (what the container runs) · `npm run openapi` (regenerate the contract) · `npm run start:otel-demo` (start with OpenTelemetry spans printed to the console) · `npm run docs:toc` (regenerate the contents list above) · `npm run db:generate` (new migration after editing `src/db/schema.ts`).

**Environments.** Configuration lives in [`config/`](config), one profile per environment: [`dev.env`](config/dev.env) (npm scripts), [`pre-prod.env`](config/pre-prod.env) and [`prod.env`](config/prod.env) (Docker Compose, chosen by `APP_ENV`). [`example.env`](config/example.env) documents every variable. Personal overrides and real secrets go in `config/local.env`, which is git-ignored and loaded after the profile; shell variables override both. Pre-prod and prod export traces to a **fake** OTLP endpoint with a **fake** key, to simulate a managed observability service; moving secrets to AWS Secrets Manager is a planned upgrade. Migrations run on start-up.

## API overview

The examples use the demo data: dealership `dlr-london` (Europe/London, 08:00–18:00, two bays). Chen (`tech-ldn-chen`) is the **only EV-qualified technician**. Times can be sent with any UTC offset; responses are always UTC. All endpoints and error codes: design doc [§8.2](docs/SYSTEM_DESIGN.md#82-api-surface).

### Check availability

```http
GET /v1/dealerships/dlr-london/availability?serviceTypeId=svc-ev&date=2026-11-02
```

Response `200` (`date` is the dealership's local date; start times sit on a 15-minute grid):

```jsonc
{
  "dealershipId": "dlr-london",
  "serviceTypeId": "svc-ev",
  "date": "2026-11-02",
  "timezone": "Europe/London",
  "durationMinutes": 90,
  "slots": [
    { "startTime": "2026-11-02T10:30:00.000Z", "endTime": "2026-11-02T12:00:00.000Z", "availableTechnicians": 1, "availableBays": 2 },
    { "startTime": "2026-11-02T10:45:00.000Z", "endTime": "2026-11-02T12:15:00.000Z", "availableTechnicians": 1, "availableBays": 2 }
    // … one entry per bookable start time, up to 16:30 (the job must finish by 18:00)
  ]
}
```

### Book an appointment

```http
POST /v1/appointments
Idempotency-Key: 7f1c-retry-safe      (optional: makes retries safe)
```

Request. The system assigns the technician and bay, so the client doesn't send them:

```json
{
  "dealershipId": "dlr-london",
  "customerId": "cust-jane",
  "vehicleId": "veh-jane-leaf",
  "serviceTypeId": "svc-ev",
  "startTime": "2026-11-02T09:00:00Z"
}
```

Response `201 Created`. The same request with the same `Idempotency-Key` returns `200` and this same appointment:

```json
{
  "id": "6903fd2a-60a6-4157-a2ad-5fb7612fe2d9",
  "status": "CONFIRMED",
  "dealershipId": "dlr-london",
  "customerId": "cust-jane",
  "vehicleId": "veh-jane-leaf",
  "serviceTypeId": "svc-ev",
  "technicianId": "tech-ldn-chen",
  "serviceBayId": "bay-ldn-1",
  "startTime": "2026-11-02T09:00:00.000Z",
  "endTime": "2026-11-02T10:30:00.000Z",
  "createdAt": "2026-10-30T03:41:40.416Z",
  "cancelledAt": null
}
```

Response `409 Conflict`: another EV check at 09:30, while Chen is busy until 10:30:

```json
{
  "error": {
    "code": "NO_TECHNICIAN_AVAILABLE",
    "message": "No qualified technician is free for the requested time",
    "requestId": "f30c589a-cea1-41bf-aea4-e9dcc088e731"
  }
}
```

Response `422 Unprocessable Entity`: a 60-minute oil change at 17:30 would finish after closing. `opensAtMinute` and `closesAtMinute` are minutes after local midnight (08:00 and 18:00):

```json
{
  "error": {
    "code": "OUTSIDE_OPERATING_HOURS",
    "message": "Appointment must start and finish within the dealership's opening hours",
    "requestId": "8f84db8f-7254-491a-8c2d-06d5a62d7228",
    "details": { "timezone": "Europe/London", "opensAtMinute": 480, "closesAtMinute": 1080 }
  }
}
```

### Cancel an appointment

```http
POST /v1/appointments/6903fd2a-60a6-4157-a2ad-5fb7612fe2d9/cancel
```

Response `200`: the appointment with `"status": "CANCELLED"` and `cancelledAt` set. Chen and the bay are free again. Cancelling twice is safe.

## Project structure

```
src/
  domain/          Pure business rules: overlap, opening hours, resource search, slots, timezones, errors
  services/        Use cases; the atomic check-and-book transaction; idempotency
  routes/v1/       HTTP routes and TypeBox schemas for /v1 (validation, types and OpenAPI from one source)
  db/              Drizzle schema, migrations runner, seed data
  observability/   Prometheus metrics
  app.ts, server.ts   App wiring and process entry
drizzle/           SQL migrations
test/              Unit, API, multi-process concurrency and query-plan tests (docs/BUILD_FOR_THE_FUTURE.md §4.1)
scripts/           Seed, cURL demo, OpenAPI export
CLAUDE.md, .claude/   The AI workflow: rules, hooks, test-runner subagent, skills, lessons, feature map
```

## Build for the future

Scalability, performance, reliability, maintainability and observability each have a section in [docs/BUILD_FOR_THE_FUTURE.md](docs/BUILD_FOR_THE_FUTURE.md): what is built in the code today, how it grows, and the trade-off. Start with the [at-a-glance table](docs/BUILD_FOR_THE_FUTURE.md#at-a-glance). In short: a stateless service whose bookings are race-proof under one locked transaction, about 0.35 ms per booking at any history size, and a planned path to managed PostgreSQL, replicas, regional deployments and managed observability, each with a measurable trigger.

## AI Collaboration Narrative

> I built this with **Claude Code**. I set the direction, made the product decisions, and approved every step before it was committed.

My approach is **goal-directed, verification-first and human-owned**: small, bounded increments, each with a clear goal, explicit acceptance criteria and a concrete way to prove the result works.

It is influenced by Lauren Tan's view of agent engineering: an agent shouldn't just produce code. It should run the application, reproduce a scenario, inspect runtime behaviour, recognise failure and show that the intended outcome was achieved.

### Working principles

1. **Define the goal before generating code.** The AI agent presented the architecture-shaping choices to me as options with trade-offs. I chose a transactional overlap check over slot locking (it supports any duration), writing the design doc alongside the code, and four extras: an availability endpoint, OpenAPI, seed data with a cURL demo, and metrics.
2. **Make acceptance criteria explicit, and prove the tests can fail.** Each requirement is a testable outcome, mapped to the tests that prove it in `.claude/feature-map.md`. For example: *four processes racing to book the only EV technician must produce exactly one confirmed appointment* (`test/concurrency.test.ts`). To show this test really catches double-booking, the AI removed the booking transaction on purpose. All four processes then booked the same technician, and the test failed. When a bug appears, the map also points an agent straight at the relevant code and tests, so it doesn't have to search the codebase. That keeps the context small and saves tokens.
3. **Use AI in narrow slices.** I chose to work **one reviewable step at a time**: the AI finishes one concern (the overlap rule, the booking transaction, API validation, tests or docs), summarises it, proposes the next step and stops for my review. I also told it to **ask about ambiguity instead of assuming**, to **stay on the core** requirements, and to run tests in a **subagent** to keep the main context small.
4. **Verify with executable evidence.** A change counts only when tests against a real database (not mocks), a running server driven by the cURL demo, logs or metrics show it working. This stops AI hallucinations, and work heading in the wrong direction, from being accepted.
5. **Keep decisions and final acceptance with the human.** Two rounds of structured questions produced the product decisions D1–D8 ([docs/DECISIONS.md](docs/DECISIONS.md)). For recovery, retention and deployment I chose the **simpler** option, against the AI's recommendation, and asked for its production design to be written up with **measurable upgrade triggers** ([docs/BUILD_FOR_THE_FUTURE.md](docs/BUILD_FOR_THE_FUTURE.md#6-upgrade-triggers) §6). No change is committed without my approval.
6. **Invest in the AI's instructions, and let them improve.** `CLAUDE.md` holds the brief's requirements word for word, the architecture rules and the scope. Skills turn routine work into repeatable steps: `verify` is the definition of done, and `add-business-rule` goes red test → domain → service → docs. I set these up after the first build; next time I would write them **before** starting, because every session after that followed the same rules without being reminded. They also improve over time: each correction becomes a lesson in `.claude/LESSONS.md`, which a hook loads into every new session. For example, "design docs state the final decision, not the discussion" became a lesson and a new check in `verify`.
7. **Match the model and effort to the task.** I used Opus 5.5 to work out a plan, then Sonnet to carry it out. The reasoning is already in the plan, so execution needs less thinking time and costs less. Mechanical work goes to the cheapest model that can do it: the `test-runner` subagent runs on Haiku and only reports a short pass/fail summary.

### Future: multi-agent development model

Today one main AI assistant does the work, with one subagent (`test-runner`) that runs the tests in a separate context. The next step is a multi-agent model, where specialised agents work with separate contexts, tools and missions. Planning, implementation, testing, runtime verification, documentation and coordination then no longer share one oversized context.

The pieces already in `.claude/` are the starting point for each agent:

| Future agent | Mission | Verification output | Starts from |
|---|---|---|---|
| **Planning** | Turn requirements into user stories, domain rules, API contracts and acceptance criteria | Task backlog and definition of done | `feature-map.md`, `planning-and-task-breakdown` skill |
| **Implementation** | Implement one bounded feature at a time | Code changes and implementation notes | `add-business-rule`, `incremental-implementation` skills |
| **Testing** | Write and run tests against the acceptance criteria | Test results and failing scenarios | `test-runner` subagent, `test-driven-development` skill |
| **Verification** | Run the application and check real runtime behaviour | API responses, logs, database state, concurrency evidence | `verify` skill (smoke run with the cURL demo) |
| **Review / documentation** | Review maintainability and keep the docs current | Review findings, updated README and OpenAPI | `code-review-and-quality`, `documentation-and-adrs` skills |
| **Coordinator** | Sequence work, resolve conflicts, decide when a human must review | Task assignments, escalations, merge recommendation | `CLAUDE.md` rules, `LESSONS.md` |

In this model, the implementation agent would not be responsible for declaring its own work complete. The testing and verification agents would independently validate the change against the original acceptance criteria. This creates a stronger feedback loop: an agent can reproduce a failing scenario, apply a targeted fix, rerun the relevant checks, and continue only when it can demonstrate success.

## Future improvements

In priority order.

| Today | Improvement | Why |
|---|---|---|
| Technicians are assumed to work all opening hours; one opening window per day | **Staff rosters:** shifts, breaks, leave, per-weekday hours and holidays | Availability can overstate capacity, so a customer could be booked with a technician who is on leave |
| No authentication | **Gateway OAuth2/OIDC**, with access limited to the advisor's own dealerships ([docs/BUILD_FOR_THE_FUTURE.md](docs/BUILD_FOR_THE_FUTURE.md#7-security-and-privacy) §7) | Protects customer data and stops one dealership reading or cancelling another's bookings |
| Every bay can host every service | **Bay capabilities** (e.g. EV charger, lift) | An EV job assigned to a bay without the right equipment can't actually be done |
| First-fit allocation | **Load-balanced allocation** and an optional preferred technician | First-fit keeps loading the same technician, while others sit idle |
| Changing a time means cancel, then rebook | **Atomic rescheduling** that keeps the original if the new slot is taken | Today the customer can lose their slot between the two calls |
| A `409` only says "not available" | **Suggested slots:** the nearest free times returned with the `409` | Saves the advisor a second search; reuses the availability engine |
| Configuration and fake keys live in committed profiles in `config/` | **Secrets in AWS Secrets Manager**, injected at start-up ([Build for the future §6](docs/BUILD_FOR_THE_FUTURE.md#6-upgrade-triggers)) | Real credentials (database accounts, vendor API keys) never sit in git or images, can be rotated without a release, and every read is audited |
| No notifications | **Confirmations, reminders and cancellations** via an outbox and domain events | Reminders reduce no-shows; the outbox makes sure no message is lost if a send fails |

Full backlog, including booking holds for a multi-step UI: [design doc §9](docs/SYSTEM_DESIGN.md#9-future-work).
