---
name: retro
description: Self-improvement loop. Captures what went wrong or was corrected in this session as durable lessons in .claude/LESSONS.md, which a SessionStart hook loads into every future session. Use at the end of a step, after the user corrects you, or when a mistake was caught.
---

# Retro: learn from this session

`.claude/LESSONS.md` is loaded into context at the start of every session by the `SessionStart` hook in `.claude/settings.json`. A lesson written here changes how future sessions behave.

1. **Collect evidence** from this session only:
   - corrections the user made,
   - tests or hooks that failed, and why,
   - things the AI got wrong and only caught on review.
2. **Keep only what generalises.** A lesson must be something a future session could get wrong again. Skip one-off typos and things already enforced by a test or hook.
3. **Write each lesson** as one entry under the right heading in `.claude/LESSONS.md`:
   ```
   - **<rule, imperative>**. <why: what went wrong, one sentence>. (<YYYY-MM-DD>)
   ```
   Merge with an existing lesson rather than duplicating it. Delete lessons that are now wrong.
4. **Promote or automate.**
   - A lesson that applies to every task belongs in `CLAUDE.md`. Move it there.
   - A lesson that can be checked mechanically should become a test, hook or skill step. Do that, and replace the lesson with a pointer to it.
5. **Show the user the diff** of `LESSONS.md` / `CLAUDE.md` and wait for approval before committing.
