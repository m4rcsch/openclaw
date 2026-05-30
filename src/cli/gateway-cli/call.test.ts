import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLI_DEFAULT_OPERATOR_SCOPES } from "../../gateway/method-scopes.js";
import { callGatewayCli } from "./call.js";

const { callGatewaySpy } = vi.hoisted(() => ({
  callGatewaySpy: vi.fn(async (_opts: Record<string, unknown>) => ({ ok: true })),
}));

vi.mock("../../gateway/call.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../gateway/call.js")>("../../gateway/call.js");
  return {
    ...actual,
    callGateway: callGatewaySpy,
  };
});

vi.mock("../progress.js", () => ({
  withProgress: (_opts: unknown, fn: () => unknown) => fn(),
}));

function firstGatewayCall(): Record<string, unknown> {
  const [callOpts] = callGatewaySpy.mock.calls[0] ?? [];
  if (!callOpts) {
    throw new Error("expected gateway call");
  }
  return callOpts;
}

describe("gateway CLI call transport", () => {
  beforeEach(() => {
    callGatewaySpy.mockClear();
  });

  it("keeps least-privilege CLI scopes when direct loopback token auth uses backend identity", async () => {
    await callGatewayCli("health", {
      url: "ws://127.0.0.1:18789",
      token: "shared-token",
    });

    expect(firstGatewayCall()).toMatchObject({
      method: "health",
      clientName: "gateway-client",
      mode: "backend",
      scopes: ["operator.read"],
      deviceIdentity: null,
    });
  });

  it("keeps broad CLI fallback scopes for unclassified direct loopback token calls", async () => {
    await callGatewayCli("plugin.custom.unclassified", {
      url: "ws://127.0.0.1:18789",
      token: "shared-token",
    });

    expect(firstGatewayCall()).toMatchObject({
      method: "plugin.custom.unclassified",
      clientName: "gateway-client",
      mode: "backend",
      scopes: CLI_DEFAULT_OPERATOR_SCOPES,
      deviceIdentity: null,
    });
  });
});
