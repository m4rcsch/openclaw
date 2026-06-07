// web_fetch direct-network tests cover URL scheme policy after direct fetch was
// split from the shared SSRF guard.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FetchMock, withFetchPreconnect } from "../../test-utils/fetch-mock.js";
import { createWebFetchTool } from "./web-fetch.js";
import { makeFetchHeaders } from "./web-fetch.test-harness.js";
import "./web-fetch.test-mocks.js";

vi.mock("../../web-fetch/runtime.js", () => ({
  resolveWebFetchDefinition: vi.fn(() => null),
}));

const lookupMock = vi.fn();

function textResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    headers: makeFetchHeaders({ "content-type": "text/plain" }),
    text: async () => body,
  } as unknown as Response;
}

function setMockFetch(
  impl: FetchMock = async (_input: RequestInfo | URL, _init?: RequestInit) => textResponse(""),
) {
  const fetchSpy = vi.fn(impl);
  global.fetch = withFetchPreconnect(fetchSpy);
  return fetchSpy;
}

function expectRawFetchSuccessDetails(details: unknown) {
  const typedDetails = details as { status?: number; extractor?: string };
  expect(typedDetails.status).toBe(200);
  expect(typedDetails.extractor).toBe("raw");
}

function createWebFetchToolForTest(params?: {
  firecrawlApiKey?: string;
  useTrustedEnvProxy?: boolean;
  cacheTtlMinutes?: number;
}) {
  return createWebFetchTool({
    config: {
      plugins: params?.firecrawlApiKey
        ? {
            entries: {
              firecrawl: {
                config: {
                  webFetch: {
                    apiKey: params.firecrawlApiKey,
                  },
                },
              },
            },
          }
        : undefined,
      tools: {
        web: {
          fetch: {
            cacheTtlMinutes: params?.cacheTtlMinutes ?? 0,
            useTrustedEnvProxy: params?.useTrustedEnvProxy,
            ...(params?.firecrawlApiKey ? { provider: "firecrawl" } : {}),
          },
        },
      },
    },
    lookupFn: lookupMock,
  });
}

async function expectRejectedUrl(
  tool: ReturnType<typeof createWebFetchToolForTest>,
  url: string,
  expectedMessage: RegExp,
) {
  await expect(tool?.execute?.("call", { url })).rejects.toThrow(expectedMessage);
}

describe("web_fetch direct network policy", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    lookupMock.mockRejectedValue(new Error("lookup should not run for direct web_fetch"));
  });

  afterEach(() => {
    global.fetch = priorFetch;
    lookupMock.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("direct fetch reaches private and fake-IP URLs without SSRF policy", async () => {
    const fetchSpy = setMockFetch().mockResolvedValue(textResponse("direct ok"));
    const tool = createWebFetchToolForTest();

    const urls = [
      "http://127.0.0.1/test",
      "http://198.18.0.153/file",
      "http://[fc00::153]/file",
    ] as const;
    for (const url of urls) {
      const result = await tool?.execute?.("call", { url });
      expectRawFetchSuccessDetails(result?.details);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(urls.length);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("allows localhost hostnames without loading DNS policy", async () => {
    const fetchSpy = setMockFetch().mockResolvedValue(textResponse("local ok"));
    const tool = createWebFetchToolForTest();

    const result = await tool?.execute?.("call", { url: "http://localhost/test" });

    expectRawFetchSuccessDetails(result?.details);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("does not run old DNS private-address checks before direct fetch", async () => {
    const fetchSpy = setMockFetch().mockResolvedValue(textResponse("dns policy ignored"));
    const tool = createWebFetchToolForTest();

    const result = await tool?.execute?.("call", { url: "https://private.test/resource" });

    expectRawFetchSuccessDetails(result?.details);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("allows public hosts", async () => {
    setMockFetch().mockResolvedValue(textResponse("ok"));
    const tool = createWebFetchToolForTest();

    const result = await tool?.execute?.("call", { url: "https://example.com" });
    expectRawFetchSuccessDetails(result?.details);
  });

  it("rejects non-HTTP URL schemes before fetch", async () => {
    const fetchSpy = setMockFetch();
    const tool = createWebFetchToolForTest();

    await expectRejectedUrl(tool, "file:///etc/hosts", /Invalid URL: must be http or https/);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
