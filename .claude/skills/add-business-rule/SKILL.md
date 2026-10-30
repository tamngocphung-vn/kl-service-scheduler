---
name: add-business-rule
description: Add or change a booking or scheduling rule (e.g. a buffer between jobs, a new rejection reason, an allocation policy). Enforces the domain → service → API → docs order with a failing test first. Use whenever booking or availability behaviour changes.
---

# Add or change a business rule

The core rules live in pure functions so they're easy to review. Keep it that way.

1. **Pin down the rule.** State it in one sentence, plus its edge cases (boundaries, timezones, back-to-back appointments). If it's ambiguous, ask the user. Don't guess. Record the decision as an assumption in `docs/DECISIONS.md`.
2. **Red test first** (follow the `test-driven-development` skill).
   - Pure logic: add a case to `test/scheduling.test.ts` (or `test/time.test.ts`).
   - Observable through the API: add a case to `test/appointments.api.test.ts` using the helpers in `test/helpers.ts`.
   - Run only the new test through `test-runner` and confirm it **fails for the right reason**.
3. **Implement in the right layer.**
   - Rule logic → `src/domain/scheduling.ts` (no I/O, no Date.now(): take time as input).
   - Loading data or transactions → `src/services/scheduling-service.ts`. Every check that decides a booking must run **inside** the existing `BEGIN IMMEDIATE` transaction in `book()`.
   - New rejection reason → add a code to `ErrorCode` in `src/domain/errors.ts`. Use 409 for a resource conflict and 422 for a business-rule violation.
4. **Make it green.** Run the `verify` skill.
5. **Update the map.** Add the rule to `.claude/feature-map.md` with its code and test locations.
6. **Stop and summarise for the user's review.** Don't start the next change.
