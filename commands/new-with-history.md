---
description: Seal the current artifact so the next `/new` inherits full context
---

The user has manually invoked `/new-with-history`. This command seals the current session-handoff artifact so that a subsequent `/new` in OpenCode creates a new session that inherits Decision Log, Key Artifacts, Subagent Outputs, Design Outputs, and DCP Chapter Index from this session.

1. Read `.sisyphus/session-handoff.md`. If it does not exist, reply with the no-artifact message at the bottom of this prompt and stop.

2. In the YAML frontmatter:
   - Populate the `goal:` field with a concise, single-sentence summary of this session's main objective.
   - Set `status: active` to `status: sealed`.
   - Do **not** modify `handoff_count`; the plugin increments it automatically.

3. Refresh every section using the latest in-memory context:
   - Append any unrecorded entries to **Decision Log**, **Key Artifacts**, **Subagent Outputs**, **Design Outputs**.
   - Update **Current State** sub-bullets (Active Goal, Blockers, Todo Snapshot from `todoread`, Open Questions).
   - Rewrite **Next Steps** as concrete, actionable items for the next session.

4. Reply with exactly:

   > Artifact sealed. Type `/new` in OpenCode to start a fresh session that inherits all accumulated context (Decision Log, Key Artifacts, Subagent Outputs, Design Outputs, and DCP Chapter Index) from this session.

If `.sisyphus/session-handoff.md` does not exist, reply with:

> No active session-handoff artifact at `.sisyphus/session-handoff.md`. The plugin auto-creates it on the first chat message — invoke `/new-with-history` after at least one message has been exchanged.
