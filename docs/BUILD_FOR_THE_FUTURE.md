# Build for the future

The brief asks that the design and implementation consider **scalability, performance, reliability, maintainability and observability**. For each of these, this page covers what is built in the code today, how it grows, and the trade-off. The targets are in [design §1.2](SYSTEM_DESIGN.md#12-non-functional-requirements). Decision IDs (D1–D13, A1–A12) refer to [DECISIONS.md](DECISIONS.md).

## At a glance

| Quality | Built in the code today | How it grows |
|---|---|---|
| [Scalability](#1-scalability) | Stateless service; every hot query scoped by `dealership_id` and a time window; history-independent overlap query | Managed PostgreSQL with per-resource exclusion constraints, replicas, a cached read path, partitioning by dealership, one deployment per region |
| [Performance](#2-performance) | About 0.35 ms per booking at any history size, against a 1 s budget | The budget absorbs a networked database and pricing logic; a Redis availability cache and in-memory reference-data cache when a trigger fires |
| [Reliability](#3-reliability) | Check and insert in one locked transaction (race-tested across 4 processes); `Idempotency-Key`; graceful shutdown; health probes | Replicas and a multi-zone database; continuous backup; an outbox for events |
| [Maintainability](#4-maintainability) | Pure domain layer; schemas generate validation, types and OpenAPI; versioned `/v1` routes; layered tests | New rules touch one layer; breaking API changes ship as `/v2` beside `/v1` |
| [Observability](#5-observability) | JSON logs with request and trace IDs, Prometheus metrics, OpenTelemetry tracing (simulated locally), health probes | A managed service for storage, dashboards and alerts, by setting an endpoint and key |

## 1. Scalability

**Built today.** The service holds nothing in memory between requests, so it can run as many replicas. Every hot query carries `dealership_id` and a time window. The overlap query is bounded on both sides (§2), so its cost doesn't grow with history: about 36k appointments a year per dealership, kept indefinitely (D6). SQLite has a single writer; at about 0.35 ms per booking that is roughly 2,800 bookings/s, far above the 50/s burst target (D10).

**How it grows.**
1. **Managed PostgreSQL** (design §2.2). The Drizzle schema ports with a dialect switch. The global write lock is replaced by **per-resource guarantees**, so no lock is held across network calls:
   - `EXCLUDE USING gist (technician_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'CONFIRMED')`, and the same for `service_bay_id` and `vehicle_id`. The database itself makes double-booking impossible, even with bookings at different dealerships running in parallel.
   - Allocation retries on an exclusion violation with the next free candidate.
2. **Stateless replicas** behind a load balancer.
3. **The availability read path** served from a read replica and the cache in §2.
4. **Partitioning by dealership** if one database becomes a bottleneck, and **one deployment per region** (§6).

**Trade-off.** Until then, bookings at different dealerships also wait for the single writer. That is acceptable at dealer-group volume (D4). Storage and backup size grow without bound until the 7-year retention rule (§6).

## 2. Performance

**Built today.** Indexed overlap queries, and a booking is one short transaction of about 6 queries. The overlap query is bounded on both sides: `starts_at < requested_end` and `starts_at > requested_start − 24 h` (`MAX_APPOINTMENT_MS` in `src/domain/scheduling.ts`). The lower bound is safe because an appointment fits inside one business day (A4), and it keeps the index scan to about a day of rows whatever the retention. Without it, latency grows with history (53 ms at 500k rows).

**Benchmark** (MacBook, Node 25, file-backed SQLite in WAL mode, 2,000 bookings for one dealership, past appointments preloaded):

| Past appointments at the dealership | Booking p50 | Booking p95 | Booking p99 | Availability query |
|---|---|---|---|---|
| 0 | 0.35 ms | 0.56 ms | 1.3 ms | 0.9 ms |
| 100,000 | 0.35 ms | 0.47 ms | 1.4 ms | 0.6 ms |
| 500,000 | 0.37 ms | 0.49 ms | 1.3 ms | 0.7 ms |

**Verified by** this benchmark, `test/query-plan.test.ts` (asserts SQLite's plan uses a range bounded on both sides), and in production the `appointment_booking_duration_seconds` and `http_request_duration_seconds` histograms.

**Trade-off.** A separately deployed database adds a network round trip per query, and pricing (e.g. holiday surcharges) will add work. Both fit inside the 1 s budget (D10).

**Caching (designed, not built).** Today's availability query takes under 1 ms, so a cache would not change what users see. It is added when a trigger fires: availability p95 above 300 ms, or read queries making up most of the database load once the database is on its own server. Caching lives in the service layer behind a small cache interface, so the in-memory and Redis versions are interchangeable, tests run without a cache, and the domain layer stays pure.

| What | Cache | Why |
|---|---|---|
| **The booking decision** | Never cached | Correctness comes first (D10). Every check re-reads inside the booking transaction, so no cache can cause a double booking. |
| **Reference data:** dealership hours and timezone, service types, technician qualifications | In memory, per instance, TTL about 5 minutes | Changes rarely and is a few KB, so no network hop is needed. Used by read endpoints only; the booking transaction still reads the database. |
| **Availability results** per (dealership, date, service type) | Managed Redis, TTL about 30 seconds, invalidated on every booking or cancellation for that dealership and date | Shared by all replicas, so one booking updates every instance's view. A per-instance memory cache would keep showing the slot as free on other replicas until it expired. A stale slot only costs a 409 at booking time, never a double booking. |
| **`/dealerships`, `/service-types` over HTTP** | `Cache-Control` headers | Lets the gateway or browser cache reference data with no code beyond a header. |

## 3. Reliability

**Consistency under concurrency (the key risk).** Two customers asking for the last slot at the same moment must not both succeed. The check and the insert run inside **one `BEGIN IMMEDIATE` transaction**. SQLite grants that lock to one writer at a time, across threads *and* processes. A second booking waits (`busy_timeout = 5s`), then re-reads and sees the first. Verified by `test/concurrency.test.ts`: **4 separate OS processes** race for the only EV technician, and exactly one succeeds. The test was mutation-checked: with the transaction removed, all four booked the same technician and the test failed.

**Failure handling, built today.**
- **`Idempotency-Key`** makes retries after a timeout safe. A partial unique index enforces it, and a reused key with a different body is rejected (422). Retries without a key are not deduplicated.
- **Graceful shutdown:** SIGTERM drains in-flight requests, then closes the database.
- **Readiness probe** checks the database; **liveness** is independent of it.
- **Migrations** are versioned SQL, applied automatically at start-up.

**Availability (99.9%).** The prototype is a single node: a host loss restored within the 4 h RTO (D5) uses about half the yearly budget. Production runs two or more replicas on a managed multi-zone database (design §2.2), which removes that single point of failure.

**Recovery (D5).** A nightly online backup of the SQLite file (`.backup` works in WAL mode) to off-host storage, kept 30 days: RPO 24 h, RTO 4 h. A restore drill should run quarterly (not yet automated). Up to a day of bookings can be lost; the upgrade to continuous backup is in §6.

**How it grows.** An **outbox** table, written in the same transaction, publishes `AppointmentConfirmed` / `AppointmentCancelled` to notifications or the DMS without dual-write inconsistency.

## 4. Maintainability

**Built today.**
- **Layering:** HTTP → service → pure domain. Business rules have no I/O and are unit-tested in isolation, so a rule change touches one layer and one test file.
- **One source of truth:** TypeBox schemas generate request validation, TypeScript types and the OpenAPI contract. Errors use stable machine-readable codes.
- **API versioning (D9):** routes live in `src/routes/v1/` and are served under `/v1`. A breaking change ships as `/v2` beside it, reusing the same services and domain. `docs/openapi.json` is regenerated on every API change, and a test checks that the served version matches `package.json`.
- **Deployability:** no database server to install; one-command Docker Compose start; migrations at start-up. One configuration profile per environment in `config/` (`dev.env`, `pre-prod.env`, `prod.env`), selected by `APP_ENV` and logged at start-up; traces are tagged with the environment. Shutdown flushes spans for at most 2 s, so an unreachable observability vendor can't delay or crash it.

### 4.1 Testing strategy

| Layer | File | What it proves |
|---|---|---|
| Unit (pure) | `test/scheduling.test.ts` | Overlap edge cases (containment, partial, back-to-back), opening-hours boundaries, free-resource filtering, slot generation and capacity counts |
| Unit (pure) | `test/time.test.ts` | Timezone conversion incl. BST/GMT, a DST change and the Sydney date line; calendar-date validation |
| API integration | `test/appointments.api.test.ts` | All three core requirements through HTTP against a real (in-memory) SQLite DB: qualified-technician assignment, bay exhaustion, whole-duration checks, vehicle double-booking, cancellation releasing resources, idempotency, every validation path, availability ↔ booking consistency |
| Concurrency | `test/concurrency.test.ts` | Multi-process race on a shared DB file books exactly once (mutation-tested) |
| Performance guard | `test/query-plan.test.ts` | The overlap query uses an index range bounded on both sides, so latency doesn't grow with history |
| Ops | `test/health.test.ts` | Probes, metrics content, request-ID propagation, OpenAPI served |
| Tracing | `test/tracing.test.ts` | The booking span records the outcome (the error code for a rejected booking) and resource IDs, never customer or vehicle IDs; its trace ID is on the booking log line |

A fixed clock is injected (`now`), so date-dependent tests are deterministic.

## 5. Observability

**Built today.** Structured JSON logs (pino) with a request ID on every line; booking outcomes logged with appointment, dealership, technician and bay IDs. `x-request-id` is accepted or generated, returned in the response and included in every error body. Prometheus metrics at `/metrics` (RED metrics, booking outcomes, lock wait). `/health` and `/ready` probes. OpenTelemetry tracing: an `appointment.book` span per booking, a child of the HTTP request span, with `trace_id` on every log line; off unless configured, and simulated locally with `npm run start:otel-demo`. Verified by `test/health.test.ts` and `test/tracing.test.ts`.

**How it grows (D11).** Point the OTLP endpoint at a managed cloud service and inject its API key at deploy time (`config/example.env` shows both variables). It stores logs, metrics and traces and runs dashboards and SLO alerts, so there is no monitoring stack to build or run. Full strategy: [design §6](SYSTEM_DESIGN.md#6-observability-strategy).

## 6. Upgrade triggers

Four choices take the simpler option on purpose: D5 (recovery), D6 (retention), D8 (deployment topology) and D13 (secrets). Each is right for a prototype at dealer-group scale, and each has a known breaking point. The table gives the production target and the **measurable trigger** for the change, so the upgrade is planned rather than forced by an incident.

| Decision | Today (prototype) | Production target | Trigger to upgrade | How |
|---|---|---|---|---|
| **D5 Recovery** | Nightly backup. RPO 24 h, RTO 4 h. | **RPO ≤ 1 min, RTO ≤ 1 h** | Before go-live with real customers: a lost confirmed booking means a customer arrives to find no slot. Or once bookings exceed a few hundred a day, when a lost day can no longer be rebuilt by hand. | Stream the SQLite WAL continuously to object storage (e.g. Litestream). On PostgreSQL: managed point-in-time recovery plus a synchronous standby. An automated quarterly restore drill, and an alert on replication lag. |
| **D6 Retention** | Keep every appointment indefinitely. | **Keep 7 years, then anonymise** personal links; keep the vehicle's service history. | Before processing real EU/UK personal data (GDPR storage limitation), or when the appointments table makes backup or restore exceed the RTO. | A scheduled job re-points appointments older than 7 years to an anonymised placeholder customer. Closed history moves to a reporting store or partitioned archive table, so the operational table holds about a year. |
| **D13 Secrets** | Configuration per environment in `config/dev.env`, `pre-prod.env` and `prod.env`, with no secrets: the simulated observability vendor needs no key. | **AWS Secrets Manager** (or the cloud's equivalent) for every credential: database accounts, the observability API key. | The first real credential: the PostgreSQL account (§1) or a real vendor key, and in any case before go-live. | The platform injects each secret as an environment variable at start-up (ECS task secrets, or External Secrets on Kubernetes), so the code, which already reads its configuration from the environment, does not change. Non-secret settings stay in the profiles. Database passwords rotate automatically; access to each secret is audited and limited to the service's role. |
| **D8 Topology** | One global deployment and database for all regions. | **One deployment per region** (e.g. EU, APAC); each dealership's data stays in its region. | Onboarding a market with data-residency rules, cross-region latency nearing the p95 target, or a regional outage that needs isolating. | `dealership_id` is on every hot query and the service is stateless: one stack per region, requests routed by dealership at the gateway, no schema change. Group reporting reads from per-region replicas. |

Scale (D4) follows the same approach: the move to PostgreSQL (§1) is triggered by a sustained booking-transaction p95 above 50 ms, or the need for more than one write node.

## 7. Security and privacy

- **Privacy (UK and EU GDPR, D10).** An appointment links a customer to a vehicle and a time, so it is personal data, and so are customer IDs in logs and traces. Only IDs are stored and logged: names and contact details stay in the DMS/CRM, and logs, metric labels and traces never carry request bodies. Appointments are kept 7 years, then anonymised (§6), and telemetry 30 days. Each region's data stays in that region (D8, §6). Access, export and erasure requests are supported; erasure re-points past appointments to one anonymised placeholder customer, so the vehicle's service history survives. Hosting and observability vendors work under data-processing agreements. Retention, the regional split, export and erasure are not built in the prototype and are required before real customer data is processed.
- **Access control.** OAuth2/OIDC at the gateway. The callers are service advisors (D1), so the service checks that the caller's token grants access to the requested `dealershipId`, and records which advisor booked or cancelled. Not built in the prototype (A10).
- **Configuration and secrets.** Each environment has its own profile. Real secrets never go into git (only `config/local.env` may hold them, and it is git-ignored) or into images (`config/` is in `.dockerignore`). The profiles hold no secrets; credentials such as the observability API key and database accounts move to AWS Secrets Manager before go-live (§6, D13).
- **Input and transport.** All input is schema-validated, unknown fields are rejected, and queries are parameterised by Drizzle. TLS ends at the gateway; the managed database encrypts data at rest.
