---
description: Seal the session-handoff artifact, populate goal field, and prepare for a new session
---

The user has manually invoked `/handoff-seal`. Perform handoff finalization now, in this session, with no further confirmation.

1. Read `.sisyphus/session-handoff.md`. If it does not exist, reply with the no-artifact message at the bottom of this prompt and stop.

2. In the YAML frontmatter at the top of the file:
   - Populate the `goal:` field with a concise, single-sentence summary of this session's main objective inferred from context so far. Example: `goal: "Fix archive cleanup to use mtime sort instead of lexicographic sort"`.
   - Set `status: active` to `status: sealed`.
   - Do **not** modify `handoff_count`; the plugin increments it automatically when the next session inherits this artifact.

3. Refresh every section using the latest in-memory context from this session:
   - Append any unrecorded entries to **Decision Log**, **Key Artifacts**, **Subagent Outputs**, **Design Outputs**.
   - Update **Current State** sub-bullets (Active Goal, Blockers, Todo Snapshot from todoread, Open Questions) to reflect the present state.
   - Rewrite **Next Steps** as concrete, actionable items for the next session.

4. Reply with exactly:

   > Handoff ready. The artifact at `.sisyphus/session-handoff.md` is sealed (goal: &lt;the goal you set&gt;). Start a fresh OpenCode session and the new session will inherit Decision Log, Key Artifacts, Subagent Outputs, Design Outputs, and DCP Chapter Index automatically.

If `.sisyphus/session-handoff.md` does not exist, reply with:

> No active session-handoff artifact at `.sisyphus/session-handoff.md`. The plugin auto-creates it on the first chat message — invoke `/handoff-seal` after at least one message has been exchanged.
