# Lessons learned

Loaded into every session by the `SessionStart` hook. Maintained with the `retro` skill.

## Testing
- **Before trusting a concurrency test, check that its requests can actually interleave.** better-sqlite3 is synchronous, so parallel `inject()` calls in one process never race; the first concurrency test passed even with no transaction. Real races need separate processes (`test/concurrency.test.ts`). (2026-10-29)
- **Prove critical tests can fail by mutating the code they guard.** A deferred transaction and no transaction were both caught only because we broke the code on purpose. (2026-10-29)
- **When a test reveals surprising framework behaviour, fix the behaviour, not the test.** Fastify's Ajv silently stripped unknown fields; the fix was `removeAdditional: false`, not deleting the test. (2026-10-29)

- **Measure performance claims before writing them down; guard fixes with a deterministic test.** The design doc said "about 1 ms per booking" without measuring it; the real figure was 53 ms at 500k rows, because the overlap query had no lower bound. The fix is guarded by an `EXPLAIN QUERY PLAN` assertion (`test/query-plan.test.ts`), not a flaky timing test. (2026-10-29)

## Tooling and housekeeping
- **Back up with git (`git stash` / `git diff`), not ad-hoc copies to temp directories.** A `cp` to a scratchpad that didn't exist failed silently and left mutated source behind. Always check the result of a backup step. (2026-10-29)
- **Don't pipe through `head` in scripts that use `set -o pipefail`.** It kills the script with SIGPIPE. (2026-10-29)
- **Validate dates semantically, not just by regex.** `Date.UTC` silently rolls `2026-02-30` over to March. (2026-10-29)

## Working with the user
- **Work one reviewable step at a time.** Finish, summarise, propose the next step, then stop. (2026-10-29)
- **Ask about ambiguous requirements; don't assume.** Record each answer as an assumption in `docs/SYSTEM_DESIGN.md` §1. (2026-10-29)
