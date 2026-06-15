// Channel Message Flows tests cover QA Lab channel preview evidence.
import { setTimeout as sleep } from "node:timers/promises";
import type { Bot } from "grammy";
import type { Message } from "grammy/types";
import { describe, expect, it, vi } from "vitest";
import {
  deleteMessageTelegram,
  editMessageTelegram,
  sendMessageTelegram,
} from "../../../../extensions/telegram/runtime-api.js";
import type { TelegramThreadSpec } from "../../../../extensions/telegram/src/bot/helpers.js";
import {
  createTelegramDraftStream,
  type TelegramDraftStream,
} from "../../../../extensions/telegram/src/draft-stream.js";
import {
  buildTelegramRichMarkdown,
  type TelegramInputRichMessage,
} from "../../../../extensions/telegram/src/rich-message.js";
import { formatReasoningMessage } from "../../../../src/agents/embedded-agent-utils.js";
import type { OpenClawConfig } from "../../../../src/config/types.openclaw.js";
import { formatChannelProgressDraftText } from "../../../../src/plugin-sdk/channel-outbound.js";

type SupportedChannel = "telegram";
type SupportedFlow = "thinking-final" | "working-final";

type ChannelMessageFlowArgs = {
  accountId?: string;
  channel: SupportedChannel;
  delayMs?: number;
  durationMs?: number;
  finalText?: string;
  flow: SupportedFlow;
  target: string;
  threadId?: number;
};

type TelegramSendFinalParams = {
  accountId?: string;
  cfg: OpenClawConfig;
  target: string;
  text: string;
  threadId?: number;
};

type TelegramFlowResult = {
  finalMessageId?: string;
  previewUpdates: number;
};

type TelegramThinkingFinalDeps = {
  createDraftStream?: (params: {
    accountId?: string;
    cfg: OpenClawConfig;
    target: string;
    threadId?: number;
  }) => TelegramDraftStream;
  sendFinal?: (params: TelegramSendFinalParams) => Promise<{ messageId?: string }>;
  sleep?: (ms: number) => Promise<void>;
};

type TelegramThinkingFinalFlowOptions = ChannelMessageFlowArgs & {
  cfg: OpenClawConfig;
  thinkingUpdates?: readonly string[];
};

type TelegramWorkingFinalFlowOptions = ChannelMessageFlowArgs & {
  cfg: OpenClawConfig;
};

const DEFAULT_THINKING_FINAL_UPDATES = [
  "I'll inspect the Telegram stream surface first.",
  "I found the reasoning preview path and I’m checking final delivery.",
  "The preview should clear before the durable final answer lands.",
] as const;

const DEFAULT_THINKING_FINAL_TEXT =
  "Final answer: the Telegram thinking preview cleared and this durable reply landed.";
const DEFAULT_WORKING_FINAL_TEXT =
  "Final answer: the Telegram working preview cleared and this durable reply landed.";
const DEFAULT_WORKING_PROGRESS_TIMELINE = [
  {
    atMs: 2_000,
    line: "🛠️ pgrep -fl Discord || true (agent)",
  },
  {
    atMs: 5_000,
    line: "🛠️ list files in /Applications/Discord.app -> run true (agent)",
  },
  {
    atMs: 7_000,
    line: "🛠️ sw_vers (agent)",
  },
  {
    atMs: 8_000,
    line: "Discord is installed as a normal '/Applications/Discord.app', not as a Homebrew-managed cask, and it's currently running.",
  },
  {
    atMs: 11_000,
    line: "🛠️ osascript -e 'tell application \"Discord\" to quit' || true sleep 3 pgrep -fl Discord || true (agent)",
  },
  {
    atMs: 14_000,
    line: "🛠️ brew install --cask --force discord (agent)",
  },
  {
    atMs: 17_000,
    line: "Homebrew found Discord as an outdated cask after updating its metadata, so this is doing a real cask reinstall.",
  },
] as const;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function requireFinalMessageId(final: { messageId?: string }, flow: SupportedFlow): string {
  const messageId = final.messageId?.trim();
  if (!messageId) {
    throw new Error(`${flow} final send did not return a durable Telegram message id`);
  }
  return messageId;
}

function usage(): string {
  return [
    "Usage:",
    "  channel-message-flows --channel telegram --target <chat-id> --flow <flow> [options]",
    "",
    "Flows:",
    "  thinking-final      Reasoning/Thinking preview, then a final answer",
    "  working-final       Editable tool-progress preview, then a final answer",
    "",
    "Options:",
    "  --account <accountId>   Telegram account id to use",
    "  --thread-id <id>        Telegram forum topic/message thread id",
    "  --delay-ms <ms>         Delay between preview updates (default: flow-specific)",
    "  --duration-ms <ms>      Simulated working duration for working-final (default: 12000)",
    "  --final-text <text>     Override the final durable message",
  ].join("\n");
}

function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function parseIntegerFlag(raw: string | undefined, label: string): number | undefined {
  if (raw == null) {
    return undefined;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${label} must be a non-negative integer.\n\n${usage()}`);
  }
  return Number(raw);
}

function parseChannelMessageFlowArgs(args: readonly string[]): ChannelMessageFlowArgs {
  if (args.includes("--help") || args.includes("-h")) {
    throw new Error(usage());
  }

  const channel = readFlagValue(args, "--channel");
  const flow = readFlagValue(args, "--flow");
  const target = readFlagValue(args, "--target") ?? readFlagValue(args, "--chat");

  if (channel !== "telegram") {
    throw new Error(`Only --channel telegram is supported for now.\n\n${usage()}`);
  }
  if (flow !== "thinking-final" && flow !== "working-final") {
    throw new Error(`Unsupported --flow ${flow ?? "<missing>"}.\n\n${usage()}`);
  }
  if (!target) {
    throw new Error(`Missing --target <chat-id>.\n\n${usage()}`);
  }

  return {
    accountId: readFlagValue(args, "--account") ?? readFlagValue(args, "--account-id"),
    channel,
    delayMs: parseIntegerFlag(readFlagValue(args, "--delay-ms"), "--delay-ms"),
    durationMs: parseIntegerFlag(readFlagValue(args, "--duration-ms"), "--duration-ms"),
    finalText: readFlagValue(args, "--final-text"),
    flow,
    target,
    threadId: parseIntegerFlag(readFlagValue(args, "--thread-id"), "--thread-id"),
  };
}

function resolveWorkingProgressLines(elapsedMs: number): string[] {
  return DEFAULT_WORKING_PROGRESS_TIMELINE.filter((entry) => entry.atMs <= elapsedMs).map(
    (entry) => entry.line,
  );
}

function formatWorkingProgressPreview(elapsedMs: number): string {
  return formatChannelProgressDraftText({
    entry: { streaming: { progress: { label: "Working", toolProgress: false } } },
    lines: resolveWorkingProgressLines(elapsedMs),
  });
}

function richMessageText(richMessage: TelegramInputRichMessage): {
  text: string;
  textMode: "markdown" | "html";
} {
  return "html" in richMessage
    ? { text: richMessage.html, textMode: "html" }
    : { text: richMessage.markdown, textMode: "markdown" };
}

function createTelegramFlowApi(params: { accountId?: string; cfg: OpenClawConfig }): Bot["api"] {
  return {
    raw: {
      sendRichMessage: async (sendParams) => {
        const richText = richMessageText(sendParams.rich_message);
        const result = await sendMessageTelegram(String(sendParams.chat_id), richText.text, {
          accountId: params.accountId,
          cfg: params.cfg,
          messageThreadId: sendParams.message_thread_id,
          textMode: richText.textMode,
        });
        return { message_id: Number(result.messageId) } as Message;
      },
      editMessageText: async (editParams) => {
        if (typeof editParams.message_id !== "number") {
          throw new Error("Telegram flow rich edit requires message_id.");
        }
        const richText = richMessageText(editParams.rich_message);
        await editMessageTelegram(
          String(editParams.chat_id),
          editParams.message_id,
          richText.text,
          {
            accountId: params.accountId,
            cfg: params.cfg,
            textMode: richText.textMode,
          },
        );
        return true;
      },
    },
    sendMessage: async (chatId, text, sendParams) => {
      const result = await sendMessageTelegram(String(chatId), text, {
        accountId: params.accountId,
        cfg: params.cfg,
        messageThreadId: sendParams?.message_thread_id,
        textMode: sendParams?.parse_mode === "HTML" ? "html" : "markdown",
      });
      return { message_id: Number(result.messageId) };
    },
    editMessageText: async (chatId, messageId, text, editParams) => {
      await editMessageTelegram(String(chatId), messageId, text, {
        accountId: params.accountId,
        cfg: params.cfg,
        textMode: editParams?.parse_mode === "HTML" ? "html" : "markdown",
      });
      return true;
    },
    deleteMessage: async (chatId, messageId) => {
      await deleteMessageTelegram(String(chatId), messageId, {
        accountId: params.accountId,
        cfg: params.cfg,
      });
      return true;
    },
  } as Bot["api"];
}

function resolveTelegramFlowThreadSpec(threadId?: number): TelegramThreadSpec | undefined {
  return typeof threadId === "number" ? { id: threadId, scope: "forum" } : undefined;
}

function createDefaultTelegramDraftStream(params: {
  accountId?: string;
  cfg: OpenClawConfig;
  target: string;
  threadId?: number;
}): TelegramDraftStream {
  return createTelegramDraftStream({
    api: createTelegramFlowApi(params),
    chatId: params.target,
    minInitialChars: 0,
    renderText: (text) => ({ text, richMessage: buildTelegramRichMarkdown(text) }),
    thread: resolveTelegramFlowThreadSpec(params.threadId),
    throttleMs: 250,
  });
}

async function sendTelegramFinal(params: TelegramSendFinalParams): Promise<{ messageId?: string }> {
  return await sendMessageTelegram(params.target, params.text, {
    accountId: params.accountId,
    cfg: params.cfg,
    messageThreadId: params.threadId,
  });
}

async function runTelegramThinkingFinalFlow(
  options: TelegramThinkingFinalFlowOptions,
  deps: TelegramThinkingFinalDeps = {},
): Promise<TelegramFlowResult> {
  const delayMs = options.delayMs ?? 900;
  const thinkingUpdates = options.thinkingUpdates ?? DEFAULT_THINKING_FINAL_UPDATES;
  const stream = (deps.createDraftStream ?? createDefaultTelegramDraftStream)({
    accountId: options.accountId,
    cfg: options.cfg,
    target: options.target,
    threadId: options.threadId,
  });
  const wait = deps.sleep ?? sleep;

  let previewStarted = false;
  let flowError: unknown;
  try {
    for (const update of thinkingUpdates) {
      previewStarted = true;
      stream.update(formatReasoningMessage(update));
      await stream.flush();
      if (delayMs > 0) {
        await wait(delayMs);
      }
    }
  } catch (error) {
    flowError = error;
  }
  let cleanupError: unknown;
  if (previewStarted) {
    try {
      await stream.clear();
    } catch (error) {
      cleanupError = error;
    }
  }
  if (flowError) {
    throw toError(flowError);
  }
  if (cleanupError) {
    throw toError(cleanupError);
  }

  const final = await (deps.sendFinal ?? sendTelegramFinal)({
    accountId: options.accountId,
    cfg: options.cfg,
    target: options.target,
    text: options.finalText ?? DEFAULT_THINKING_FINAL_TEXT,
    threadId: options.threadId,
  });

  const finalMessageId = requireFinalMessageId(final, "thinking-final");
  return {
    finalMessageId,
    previewUpdates: thinkingUpdates.length,
  };
}

async function runTelegramWorkingFinalFlow(
  options: TelegramWorkingFinalFlowOptions,
  deps: TelegramThinkingFinalDeps = {},
): Promise<TelegramFlowResult> {
  const delayMs = options.delayMs ?? 2_000;
  const durationMs = options.durationMs ?? 12_000;
  const stream = (deps.createDraftStream ?? createDefaultTelegramDraftStream)({
    accountId: options.accountId,
    cfg: options.cfg,
    target: options.target,
    threadId: options.threadId,
  });
  const wait = deps.sleep ?? sleep;

  let previewUpdates = 0;
  let lastPreviewText = "";
  const updateIntervalMs = delayMs > 0 ? delayMs : 1_000;
  let draftStarted = false;
  let flowError: unknown;
  try {
    for (let elapsedMs = 0; elapsedMs < durationMs; elapsedMs += updateIntervalMs) {
      const previewText = formatWorkingProgressPreview(elapsedMs);
      if (previewText !== lastPreviewText) {
        draftStarted = true;
        stream.update(previewText);
        await stream.flush();
        lastPreviewText = previewText;
        previewUpdates += 1;
      }
      if (delayMs > 0 && elapsedMs + updateIntervalMs < durationMs) {
        await wait(delayMs);
      }
    }
  } catch (error) {
    flowError = error;
  }
  let cleanupError: unknown;
  if (draftStarted) {
    try {
      await stream.clear();
    } catch (error) {
      cleanupError = error;
    }
  }
  if (flowError) {
    throw toError(flowError);
  }
  if (cleanupError) {
    throw toError(cleanupError);
  }

  const final = await (deps.sendFinal ?? sendTelegramFinal)({
    accountId: options.accountId,
    cfg: options.cfg,
    target: options.target,
    text: options.finalText ?? DEFAULT_WORKING_FINAL_TEXT,
    threadId: options.threadId,
  });

  const finalMessageId = requireFinalMessageId(final, "working-final");
  return {
    finalMessageId,
    previewUpdates,
  };
}

describe("channel message flows dev runner", () => {
  function createTestDraftStream(params?: {
    update?: (text: string) => void;
    flush?: () => Promise<void>;
    clear?: () => Promise<void>;
  }) {
    return {
      update: vi.fn(params?.update ?? (() => {})),
      flush: vi.fn(params?.flush ?? (async () => {})),
      clear: vi.fn(params?.clear ?? (async () => {})),
      stop: vi.fn(async () => {}),
      messageId: vi.fn(() => 17),
      forceNewMessage: vi.fn(),
    };
  }

  it("parses the Telegram thinking-final flow from channel/target flags", () => {
    const parsed = parseChannelMessageFlowArgs([
      "--channel",
      "telegram",
      "--target",
      "123",
      "--flow",
      "thinking-final",
      "--account",
      "sut",
      "--thread-id",
      "42",
      "--delay-ms",
      "0",
    ]);

    expect(parsed).toEqual({
      accountId: "sut",
      channel: "telegram",
      delayMs: 0,
      flow: "thinking-final",
      target: "123",
      threadId: 42,
    });
  });

  it("parses the Telegram working-final flow from channel/chat flags", () => {
    const parsed = parseChannelMessageFlowArgs([
      "--channel",
      "telegram",
      "--chat",
      "123",
      "--flow",
      "working-final",
      "--duration-ms",
      "12000",
      "--delay-ms",
      "0",
    ]);

    expect(parsed).toEqual({
      channel: "telegram",
      delayMs: 0,
      durationMs: 12000,
      flow: "working-final",
      target: "123",
    });
  });

  it("streams thinking updates, clears the preview, then sends the final answer", async () => {
    const events: string[] = [];
    const stream = {
      update: vi.fn((text: string) => {
        events.push(`update:${text}`);
      }),
      flush: vi.fn(async () => {
        events.push("flush");
      }),
      clear: vi.fn(async () => {
        events.push("clear");
      }),
      stop: vi.fn(async () => {}),
      messageId: vi.fn(() => 17),
      forceNewMessage: vi.fn(),
    };
    const sendFinal = vi.fn(async () => {
      events.push("final");
      return { messageId: "99", chatId: "123" };
    });

    const result = await runTelegramThinkingFinalFlow(
      {
        cfg: {} as OpenClawConfig,
        delayMs: 0,
        target: "123",
        thinkingUpdates: ["Checking the request.", "Reading the Telegram code.", "Ready."],
      },
      {
        createDraftStream: vi.fn(() => stream),
        sendFinal,
        sleep: vi.fn(async () => {}),
      },
    );

    expect(stream.update).toHaveBeenCalledTimes(3);
    expect(stream.update.mock.calls[0]?.[0]).toContain("Thinking");
    expect(stream.update.mock.calls[0]?.[0]).toContain("_Checking the request._");
    expect(events.at(-2)).toBe("clear");
    expect(events.at(-1)).toBe("final");
    expect(sendFinal).toHaveBeenCalledWith({
      accountId: undefined,
      cfg: {},
      target: "123",
      text: "Final answer: the Telegram thinking preview cleared and this durable reply landed.",
      threadId: undefined,
    });
    expect(result).toEqual({ finalMessageId: "99", previewUpdates: 3 });
  });

  it("clears thinking previews when streaming fails before the final answer", async () => {
    const stream = {
      update: vi.fn(() => {}),
      flush: vi.fn(async () => {
        throw new Error("flush failed");
      }),
      clear: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      messageId: vi.fn(() => 17),
      forceNewMessage: vi.fn(),
    };
    const sendFinal = vi.fn(async () => ({ messageId: "99", chatId: "123" }));

    await expect(
      runTelegramThinkingFinalFlow(
        {
          cfg: {} as OpenClawConfig,
          delayMs: 0,
          target: "123",
          thinkingUpdates: ["Checking the request."],
        },
        {
          createDraftStream: vi.fn(() => stream),
          sendFinal,
          sleep: vi.fn(async () => {}),
        },
      ),
    ).rejects.toThrow("flush failed");

    expect(stream.clear).toHaveBeenCalledOnce();
    expect(sendFinal).not.toHaveBeenCalled();
  });

  it("fails thinking-final when the final send does not return a message id", async () => {
    const stream = {
      update: vi.fn(() => {}),
      flush: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      messageId: vi.fn(() => 17),
      forceNewMessage: vi.fn(),
    };

    await expect(
      runTelegramThinkingFinalFlow(
        {
          cfg: {} as OpenClawConfig,
          delayMs: 0,
          target: "123",
          thinkingUpdates: ["Checking the request."],
        },
        {
          createDraftStream: vi.fn(() => stream),
          sendFinal: vi.fn(async () => ({})),
          sleep: vi.fn(async () => {}),
        },
      ),
    ).rejects.toThrow("thinking-final final send did not return a durable Telegram message id");
  });

  it("streams working updates through rich message drafts before the final answer", async () => {
    const stream = createTestDraftStream();
    const sendFinal = vi.fn(async () => ({ messageId: "100", chatId: "123" }));

    const result = await runTelegramWorkingFinalFlow(
      {
        cfg: {} as OpenClawConfig,
        delayMs: 0,
        durationMs: 12_000,
        target: "123",
      },
      {
        createDraftStream: vi.fn(() => stream),
        sendFinal,
        sleep: vi.fn(async () => {}),
      },
    );

    expect(stream.update).toHaveBeenNthCalledWith(1, "Working");
    expect(stream.update.mock.calls[2]?.[0]).toContain("🛠️ pgrep -fl Discord || true (agent)");
    expect(stream.update.mock.calls[2]?.[0]).toContain(
      "🛠️ list files in /Applications/Discord.app -> run true (agent)",
    );
    expect(stream.update.mock.calls[4]?.[0]).toContain(
      "• Discord is installed as a normal '/Applications/Discord.app'",
    );
    expect(stream.update).toHaveBeenCalledWith(
      expect.stringContaining("Working\n\n🛠️ pgrep -fl Discord || true (agent)"),
    );
    expect(stream.clear).toHaveBeenCalledBefore(sendFinal);
    expect(sendFinal).toHaveBeenCalledWith({
      accountId: undefined,
      cfg: {},
      target: "123",
      text: "Final answer: the Telegram working preview cleared and this durable reply landed.",
      threadId: undefined,
    });
    expect(stream.update).not.toHaveBeenCalledWith(expect.stringContaining("Working for"));
    expect(result).toEqual({ finalMessageId: "100", previewUpdates: 6 });
  });

  it("clears rich working drafts when progress updates fail before the final answer", async () => {
    const stream = createTestDraftStream({
      update: () => {
        throw new Error("draft update failed");
      },
    });
    const sendFinal = vi.fn(async () => ({ messageId: "100", chatId: "123" }));

    await expect(
      runTelegramWorkingFinalFlow(
        {
          cfg: {} as OpenClawConfig,
          delayMs: 0,
          durationMs: 12_000,
          target: "123",
        },
        {
          createDraftStream: vi.fn(() => stream),
          sendFinal,
          sleep: vi.fn(async () => {}),
        },
      ),
    ).rejects.toThrow("draft update failed");

    expect(stream.clear).toHaveBeenCalledOnce();
    expect(sendFinal).not.toHaveBeenCalled();
  });

  it("fails working-final when the final send does not return a message id", async () => {
    const stream = createTestDraftStream();

    await expect(
      runTelegramWorkingFinalFlow(
        {
          cfg: {} as OpenClawConfig,
          delayMs: 0,
          durationMs: 12_000,
          target: "123",
        },
        {
          createDraftStream: vi.fn(() => stream),
          sendFinal: vi.fn(async () => ({})),
          sleep: vi.fn(async () => {}),
        },
      ),
    ).rejects.toThrow("working-final final send did not return a durable Telegram message id");
  });

  it("uses two second progress update cadence by default", async () => {
    const stream = createTestDraftStream();
    const sleep = vi.fn(async () => {});

    const result = await runTelegramWorkingFinalFlow(
      {
        cfg: {} as OpenClawConfig,
        durationMs: 20_000,
        target: "123",
      },
      {
        createDraftStream: vi.fn(() => stream),
        sendFinal: vi.fn(async () => ({ messageId: "101", chatId: "123" })),
        sleep,
      },
    );

    expect(sleep).toHaveBeenCalledTimes(9);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(result.previewUpdates).toBe(7);
  });

  it("maps flow thread ids to Telegram forum topic specs", () => {
    expect(resolveTelegramFlowThreadSpec(42)).toEqual({ id: 42, scope: "forum" });
    expect(resolveTelegramFlowThreadSpec()).toBeUndefined();
  });
});
