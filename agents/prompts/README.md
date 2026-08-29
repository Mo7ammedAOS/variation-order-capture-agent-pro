# Agent Prompts

One prompt per agent: `<agent-slug>.prompt.md`.

None written yet — every agent spec is still a stub.

## Rules

```text
Prompts are files, never string literals in application code.
A prompt change is a reviewable diff. This system drafts contractual notices.
Never put a client name, contract value, or real project data in a prompt template.
  Those arrive as runtime inputs.
State the output JSON schema in the prompt itself, and validate the response
  against it before the application trusts a single field.
Every prompt states what the agent must NOT decide, in the prompt, not just in docs.
```
