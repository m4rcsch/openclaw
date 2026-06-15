---
name: channel-message-flows
description: "Use when validating local channel message flow QA evidence."
---

# Channel Message Flows

Use this from the OpenClaw repo root to validate canned channel preview flows as deterministic QA evidence.

## Telegram

Run the QA scenario:

```bash
pnpm openclaw qa suite \
  --scenario channel-message-flows \
  --output-dir .artifacts/qa-e2e/channel-message-flows
```

Run the focused Vitest proof:

```bash
node scripts/run-vitest.mjs \
  test/e2e/qa-lab/channels/channel-message-flows.e2e.test.ts \
  --reporter=verbose
```

## Notes

- `working-final` covers static `Working` status with sample tool progress before a durable final answer.
- `thinking-final` covers formatted `Thinking` reasoning preview clearing before a durable final answer.
- The QA scenario is deterministic and does not send live Telegram messages.
- For live Telegram proof, use the Telegram Crabbox E2E proof workflow instead.
