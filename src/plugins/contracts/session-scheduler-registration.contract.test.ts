// Session scheduler registration tests cover plugin-owned job snapshotting.
import {
  createPluginRegistryFixture,
  registerTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { runPluginHostCleanup } from "../host-hook-cleanup.js";
import {
  cleanupPluginSessionSchedulerJobs,
  clearPluginHostRuntimeState,
  listPluginSessionSchedulerJobs,
  registerPluginSessionSchedulerJob,
} from "../host-hook-runtime.js";
import type { PluginSessionSchedulerJobRegistration } from "../host-hooks.js";
import { createEmptyPluginRegistry } from "../registry-empty.js";
import { setActivePluginRegistry } from "../runtime.js";
import { createPluginRecord } from "../status.test-helpers.js";

describe("plugin session scheduler registration", () => {
  afterEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
    clearPluginHostRuntimeState();
  });

  it("snapshots scheduler job callbacks before host cleanup", async () => {
    let idReads = 0;
    let cleanupReads = 0;
    const cleanupEvents: string[] = [];
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "volatile-scheduler",
        name: "Volatile Scheduler",
      }),
      register(api) {
        api.registerSessionSchedulerJob({
          get id() {
            idReads += 1;
            if (idReads > 1) {
              throw new Error("job id getter re-read");
            }
            return "job-cleanup";
          },
          sessionKey: "agent:main:main",
          kind: "session-turn",
          description: "Cleanup job",
          get cleanup() {
            cleanupReads += 1;
            if (cleanupReads > 1) {
              throw new Error("cleanup getter re-read");
            }
            return ({ reason }) => {
              cleanupEvents.push(reason);
            };
          },
        } as PluginSessionSchedulerJobRegistration);
      },
    });
    setActivePluginRegistry(registry.registry);

    expect(registry.registry.sessionSchedulerJobs?.[0]?.job.description).toBe("Cleanup job");
    expect(idReads).toBe(1);
    expect(cleanupReads).toBe(1);

    await expect(
      runPluginHostCleanup({
        registry: registry.registry,
        pluginId: "volatile-scheduler",
        reason: "disable",
        sessionStorePaths: [],
      }),
    ).resolves.toEqual({ cleanupCount: 0, failures: [] });
    expect(cleanupEvents).toEqual(["disable"]);
    expect(idReads).toBe(1);
    expect(cleanupReads).toBe(1);
  });

  it("snapshots runtime scheduler jobs before storing cleanup state", async () => {
    let idReads = 0;
    const cleanupEvents: string[] = [];

    expect(
      registerPluginSessionSchedulerJob({
        pluginId: "runtime-scheduler",
        pluginName: "Runtime Scheduler",
        job: {
          get id() {
            idReads += 1;
            if (idReads > 1) {
              throw new Error("runtime job id getter re-read");
            }
            return "runtime-job";
          },
          sessionKey: "agent:main:main",
          kind: "session-turn",
          cleanup({ reason }) {
            cleanupEvents.push(reason);
          },
        } as PluginSessionSchedulerJobRegistration,
      }),
    ).toEqual({
      id: "runtime-job",
      pluginId: "runtime-scheduler",
      sessionKey: "agent:main:main",
      kind: "session-turn",
    });
    expect(idReads).toBe(1);

    await expect(
      cleanupPluginSessionSchedulerJobs({
        pluginId: "runtime-scheduler",
        reason: "disable",
      }),
    ).resolves.toEqual([]);
    expect(cleanupEvents).toEqual(["disable"]);
    expect(listPluginSessionSchedulerJobs("runtime-scheduler")).toEqual([]);
    expect(idReads).toBe(1);
  });
});
