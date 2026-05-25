---
description: Seal the session-handoff artifact and prepare a fresh OpenCode session
---

The user has manually invoked `/handoff`. Perform handoff finalization now, in this session, with no further confirmation.

1. Read `.sisyphus/session-handoff.md`. If it does not exist, reply with the no-artifact message at the bottom of this prompt and stop.
2. Refresh every section using the latest in-memory context from this session:
   - Append unrecorded entries to **Decision Log**, **Key Artifacts**, **Subagent Outputs**, **Design Outputs**.
   - Update **Current State** sub-bullets (Active Goal, Blockers, Todo Snapshot from todoread, Open Questions) to reflect the present state.
   - Rewrite **Next Steps** as a concrete, actionable continuation list for the next session.
3. In the YAML frontmatter at the top of the file, set the line `status: active` to `status: sealed`. Do **not** modify `handoff_count`; the plugin will increment it automatically when the next session starts and inherits this artifact.
4. Reply with exactly:

   > Handoff ready. The artifact at `.sisyphus/session-handoff.md` is sealed. Start a fresh OpenCode session and the new session will inherit Decision Log, Key Artifacts, Subagent Outputs, Design Outputs, and DCP Chapter Index automatically.

If `.sisyphus/session-handoff.md` does not exist, reply with:

> No active session-handoff artifact at `.sisyphus/session-handoff.md`. The plugin auto-creates it on the first chat message — invoke `/handoff` after at least one message has been exchanged.
