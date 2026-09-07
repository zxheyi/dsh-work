# Familiar Work v5 usability observation

Status: pending human observation

This record covers F13 only. Automated desktop tests verify the same controls and state transitions, but they do not count as participant results.

## Participants and conditions

- Recruit five people who have previously used DSH Desktop or DSH Web.
- Use the tested revision and one prepared Workspace containing a readable Markdown or text source.
- Do not teach product terms or point to controls. The observer may repeat the task wording and may stop a participant for safety.
- Record the revision, platform, window size and observer before the first session.

- Revision: _pending_
- Platform: _pending_
- Observer: _pending_
- Observation date: _pending_

## Task

Ask each participant to complete this outcome in their own words:

> Start a new conversation, add the supplied source, approve the one requested operation, create a Markdown result, read its content and sources, ask for one change, save a copy, then return to the conversation and continue typing.

A participant succeeds when they complete the flow without terminology teaching, another person taking control, or losing the selected conversation, source, result, or unsent draft. A recoverable wrong click does not fail the task. Record where they hesitated and any wording they misunderstood.

## Observation record

| Participant | Existing DSH experience | Completed without terminology teaching | Blocking step or hesitation | Notes |
| --- | --- | --- | --- | --- |
| P1 | not observed | not observed | — | — |
| P2 | not observed | not observed | — | — |
| P3 | not observed | not observed | — | — |
| P4 | not observed | not observed | — | — |
| P5 | not observed | not observed | — | — |

F13 passes only after at least four rows contain a witnessed “yes”. Keep the implementation task pending until this table contains real observations from the recorded revision.

## Release preparation handoff (2026-09-07)

The owner confirmed no participant observations exist. Keep every row above unobserved. Use the current [automated evidence](familiar-work-v5-evidence.json) and [packaging instructions](../packaging.md) to prepare an isolated test installation, record its exact revision and platform, then recruit five existing DSH users. Do not enter an automated runner, the implementation agent or a simulated persona as a participant. Signing/notarization is separately pending; these records cannot satisfy that gate.
