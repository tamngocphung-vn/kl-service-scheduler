# CLAUDE.md

Unified Service Scheduler: Keyloop assessment, backend. Books dealership service appointments when a qualified technician **and** a bay are both free for the whole duration.

Core Requirements:
1. Resource Constrained Booking: Allow a user to request a service
appointment for a specific vehicle, service type, and dealership at a
desired time.
2. Real-Time Availability Check: Before confirming, check for the
availability of both a ServiceBay and a qualified Technician for the entire
service duration.
3. Confirmed Appointment Record: Upon success, create a persistent
Appointment record associating the customer, vehicle, technician, and
service bay.

## Commands
- `npm test`: all tests (Vitest). **Run it through the `test-runner` subagent, not in the main context.**
- `npm run typecheck`: also runs automatically after every `.ts` edit (PostToolUse hook).
- `npm run seed && npm start`: local server on :3000 (`/docs` for Swagger). `npm run demo` runs the cURL walkthrough.
- `npm run db:generate`: new migration after editing `src/db/schema.ts`. Never hand-edit `drizzle/`.

## Architecture rules
- Layers: `routes/` (thin, TypeBox schemas) → `services/` (I/O, transactions) → `domain/` (pure rules, no I/O, no clock).
- Every check that decides a booking runs **inside** the `BEGIN IMMEDIATE` transaction in `SchedulingService.book()`.
- Times are UTC epoch ms internally, half-open `[start, end)`. Opening hours are in the dealership's IANA timezone.
- Errors: throw `AppError` with a stable `ErrorCode`. Use 409 for a resource conflict and 422 for a business-rule violation.
- Requirement → code → test map: `.claude/feature-map.md`. Keep it current.

## Scope
Core is R1–R3 in the feature map. Availability, cancel, idempotency and metrics exist, but their scope is **frozen**. Shifts, bay capabilities, auth, events and tracing are documented as future work in `docs/SYSTEM_DESIGN.md` §10, not built.

## How to work here
- **One reviewable step at a time.** Finish, summarise, propose the next step, then stop for the user's review.
- **Ask, don't assume** on ambiguous requirements. Record decisions in `docs/SYSTEM_DESIGN.md` §1.
- New or changed booking rules: use the `add-business-rule` skill. Before saying "done" or committing: use the `verify` skill.
- After a correction or a caught mistake, use the `retro` skill. Lessons in `.claude/LESSONS.md` load automatically each session.
- Commits: small and logical, conventional-commit style, with a `Co-Authored-By: Claude` trailer.

## Skills (`.claude/skills/`)
Project skills: `add-business-rule` (booking rule changes), `verify` (definition of done, before every commit), `retro` (self-improvement loop). They are the entry points and call the general engineering skills below for detail.

| When | Use | Notes |
|---|---|---|
| Writing or changing tests or logic | `test-driven-development` | Used inside `add-business-rule`. Here a "red" test must also be mutation-checked (see `verify`). |
| Implementing anything touching more than one file | `incremental-implementation` | Same intent as "one reviewable step at a time". |
| Changing an endpoint, request/response shape or error code | `api-and-interface-design` | Keep the `/v1` contract backward compatible; regenerate `docs/openapi.json`. |
| Before every commit | `code-review-and-quality`, then `code-simplification` if the review flags complexity | Run from `verify` step 4. |
| Committing, splitting work into commits, pushing | `git-workflow-and-versioning` | Never `git reset --hard` or force-push without the user's explicit approval. |
| Performance claims or fixes | `performance-optimization` | Measure first (see the benchmark in `SYSTEM_DESIGN.md` §5.0). |
| Recording a design decision | `documentation-and-adrs` | Decisions live in `SYSTEM_DESIGN.md` §1 (D-numbers), not in separate ADR files. |
| Setting up or tuning `CLAUDE.md`, skills or context | `context-engineering` | |
| Only when the user asks | `planning-and-task-breakdown`, `constraint-driven-development`, `doubt-driven-development` | Heavier processes (extra files, adversarial sub-reviews). Not on by default. |

`using-agent-skills` (the pack's router) refers to skills not in this repo (e.g. `interview-me`, `spec-driven-development`, `debugging-and-error-recovery`, `security-and-hardening`) and several skills link to `../../references/*.md` files that aren't in this repo. Ignore those references. Our definition of done is the `verify` skill.
