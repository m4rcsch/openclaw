// Feishu tests cover card interaction plugin behavior.
import { describe, expect, it } from "vitest";
import {
  buildFeishuCardActionTextFallback,
  createFeishuCardInteractionEnvelope,
  decodeFeishuCardAction,
} from "./card-interaction.js";

describe("feishu card interaction decoder", () => {
  it("decodes valid structured payloads", () => {
    const result = decodeFeishuCardAction({
      now: 1_700_000_000_000,
      event: {
        operator: { open_id: "u123" },
        context: { chat_id: "chat1" },
        action: {
          value: createFeishuCardInteractionEnvelope({
            k: "quick",
            a: "feishu.quick_actions.help",
            q: "/help",
            c: { u: "u123", h: "chat1", t: "group", e: 1_700_000_060_000 },
          }),
        },
      },
    });

    expect(result).toEqual({
      kind: "structured",
      envelope: {
        oc: "ocf1",
        k: "quick",
        a: "feishu.quick_actions.help",
        q: "/help",
        c: { u: "u123", h: "chat1", t: "group", e: 1_700_000_060_000 },
      },
    });
  });

  it("falls back for legacy text-like payloads", () => {
    const result = decodeFeishuCardAction({
      event: {
        operator: { open_id: "u123" },
        context: { chat_id: "chat1" },
        action: { value: { text: "/ping" } },
      },
    });

    expect(result).toEqual({ kind: "legacy", text: "/ping" });
    expect(
      buildFeishuCardActionTextFallback({
        operator: { open_id: "u123" },
        context: { chat_id: "chat1" },
        action: { value: { command: "/new" } },
      }),
    ).toBe("/new");
    expect(
      buildFeishuCardActionTextFallback({
        operator: { open_id: "u123" },
        context: { chat_id: "chat1" },
        action: { value: { command: "/named" }, name: "named_button" },
      }),
    ).toBe("/named");
  });

  it("preserves legacy card action sibling payload fields", () => {
    const result = buildFeishuCardActionTextFallback({
      operator: { open_id: "u123" },
      context: { chat_id: "chat1" },
      action: {
        value: { command: "/submit", field: "expense" },
        option: "approved",
        options: [],
        form_value: {},
        input_value: "Dinner with customer",
        name: "expense_reason",
      },
    });

    expect(JSON.parse(result)).toEqual({
      command: "/submit",
      field: "expense",
      option: "approved",
      options: [],
      form_value: {},
      input_value: "Dinner with customer",
      name: "expense_reason",
    });
  });

  it("rejects malformed structured payloads", () => {
    const result = decodeFeishuCardAction({
      event: {
        operator: { open_id: "u123" },
        context: { chat_id: "chat1" },
        action: {
          value: {
            oc: "ocf1",
            k: "quick",
            a: "broken",
            m: { bad: { nested: true } },
          },
        },
      },
    });

    expect(result).toEqual({ kind: "invalid", reason: "malformed" });
  });

  it("rejects stale payloads", () => {
    const result = decodeFeishuCardAction({
      now: 100,
      event: {
        operator: { open_id: "u123" },
        context: { chat_id: "chat1" },
        action: {
          value: createFeishuCardInteractionEnvelope({
            k: "button",
            a: "stale",
            c: { e: 99, t: "group" },
          }),
        },
      },
    });

    expect(result).toEqual({ kind: "invalid", reason: "stale" });
  });

  it("rejects wrong-conversation payloads when chat context is enforced", () => {
    const result = decodeFeishuCardAction({
      event: {
        operator: { open_id: "u123" },
        context: { chat_id: "chat2" },
        action: {
          value: createFeishuCardInteractionEnvelope({
            k: "button",
            a: "scoped",
            c: { u: "u123", h: "chat1", t: "group", e: Date.now() + 60_000 },
          }),
        },
      },
    });

    expect(result).toEqual({ kind: "invalid", reason: "wrong_conversation" });
  });

  it("rejects malformed chat-type context", () => {
    const result = decodeFeishuCardAction({
      event: {
        operator: { open_id: "u123" },
        context: { chat_id: "chat1" },
        action: {
          value: {
            oc: "ocf1",
            k: "button",
            a: "bad",
            c: { t: "private" },
          },
        },
      },
    });

    expect(result).toEqual({ kind: "invalid", reason: "malformed" });
  });
});
