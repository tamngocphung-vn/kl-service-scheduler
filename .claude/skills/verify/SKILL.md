---
name: verify
description: Full verification before declaring a change done or committing. Runs the typecheck and tests through the test-runner subagent, then smoke-tests the real server. Use when the user says "verify", before a commit, or when a step is finished.
---

# Verify a change

Don't claim a change works until every step below has passed in this session.

1. **Typecheck and tests.** Delegate to the `test-runner` subagent; don't run `npm test` in the main context. If anything fails, fix it and re-run before continuing.
2. **Test quality spot-check.** For each test added or changed, ask: *would this test fail if the code under test were broken?* If you're not sure, temporarily break the code (one mutation), confirm the test goes red, then restore it. Back up with `git stash` or `git diff`, not ad-hoc copies, and confirm with `git diff` afterwards that nothing mutated is left.
3. **Smoke run.** Use a fresh database and a port other than 3000, so nothing collides with a server the user is running:
   ```bash
   rm -rf /tmp/sched-verify && DATABASE_PATH=/tmp/sched-verify/db.sqlite npm run seed
   DATABASE_PATH=/tmp/sched-verify/db.sqlite PORT=3999 npm start &   # run in background
   bash scripts/demo.sh http://localhost:3999
   ```
   Check the status codes match the step headings in the demo output, then stop the server.
4. **Review.** Use the `code-review-and-quality` skill to review the full diff (`git diff` plus untracked files) along its axes. Fix findings or list them for the user.
5. **Docs drift.** If routes or schemas changed, run `npm run openapi` and check `.claude/feature-map.md` still points at the right files and tests. If a doc changed:
   - Render every Mermaid block it contains with mermaid-cli (`npx -y @mermaid-js/mermaid-cli@11.4.2 -i <block>.mmd -o <out>.svg`, run from the scratchpad). A diagram that reads fine as text can still fail to parse.
   - If headings changed, check that relative links and `#anchors` across `README.md` and `docs/` still resolve. The README contents list is regenerated automatically by the `readme-toc.sh` hook after every README edit.
   - Re-read the changed lines as a reviewer: decisions and trade-offs only, no history of how they were reached (see `.claude/LESSONS.md`, Documentation).
6. **Report.** Say what was run and what passed, and anything that was skipped.
