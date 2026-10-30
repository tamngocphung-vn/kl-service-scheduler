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

## Documentation
- **Write design docs as the final decision and its trade-off, not the discussion or history behind it.** Reviewers read the result: drafts of the design doc carried discussion ("if the database moved to its own server while keeping one write lock…", "the earlier draft", before/after "Finding (fixed)"). Process history belongs only in the GenAI / AI Collaboration sections. Prefer a short prose statement over a large table (a GDPR article-by-article table became one privacy paragraph). (2026-10-30)
- **Keep each fact in one place and link to it.** The README and design doc both listed endpoints and tests, and the copies drifted (a stale "83 tests"). (2026-10-30)
- **Check user-supplied prose against the repo before adopting it.** A pasted narrative had dangling citations, a repository layer and database constraints the code doesn't have, and a claim contradicting git history. Keep the user's voice; fix the facts and say what changed. (2026-10-30)
- **Render Mermaid diagrams before calling docs done** (`verify` step 5). A `;` inside a sequence-diagram message and one-line ER attribute blocks broke two diagrams that looked fine as text. (2026-10-30)

## Working with the user
- **Never attribute actions or decisions to the user that the record doesn't show.** The first AI-collaboration narrative was written in the user's voice and credited them with choices the AI had made. Write from evidence (git log, the user's own messages). Keep anything only the user can confirm as a reminder list for them, not as markers in the docs: the user removed the **[CHECK]** markers and asked to be reminded instead. (2026-10-29, updated 2026-10-30)
- **Work one reviewable step at a time.** Finish, summarise, propose the next step, then stop. (2026-10-29)
- **Ask about ambiguous requirements; don't assume.** Record each answer as an assumption in `docs/DECISIONS.md`. (2026-10-29)
