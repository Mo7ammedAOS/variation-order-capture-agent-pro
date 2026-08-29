# Claude Integration — the AI provider abstraction

CLAUDE.md: *"Create an AI-provider abstraction so other models can be added later."*

Nothing here calls the Anthropic SDK directly from a service or a route. Everything
goes through this boundary, so the provider can be swapped and every call can be
logged, cost-tracked, and audited in one place.

```text
Agent spec + prompt   /agents/<slug>.agent.md, /agents/prompts/<slug>.prompt.md
Provider abstraction  here
Model selection       ANTHROPIC_MODEL in .env, never a literal at the call site
Output validation     every response validated against the agent's JSON schema
                      before the application trusts a single field
```

An unparseable or schema-invalid response is a failure, not a partial success.
It must never be written through as if it were data.
