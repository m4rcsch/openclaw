// Gateway discovery service registration tests cover advertise callback snapshotting.
import {
  createPluginRegistryFixture,
  registerTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { resetPluginRuntimeStateForTest } from "../runtime.js";
import { createPluginRecord } from "../status.test-helpers.js";
import type {
  OpenClawGatewayDiscoveryAdvertiseContext,
  OpenClawGatewayDiscoveryService,
} from "../types.js";

const advertiseContext: OpenClawGatewayDiscoveryAdvertiseContext = {
  machineDisplayName: "Lab",
  gatewayPort: 18789,
  gatewayTlsEnabled: false,
  gatewayDirectReachable: false,
  minimal: true,
};

describe("plugin gateway discovery service registration", () => {
  afterEach(() => {
    resetPluginRuntimeStateForTest();
  });

  it("snapshots discovery service fields before advertise", async () => {
    let idReads = 0;
    let advertiseReads = 0;
    const events: string[] = [];
    const advertise: OpenClawGatewayDiscoveryService["advertise"] = function (
      this: { marker?: string },
      ctx,
    ) {
      events.push(`${this.marker ?? "missing"}:${ctx.gatewayPort}`);
    };
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "volatile-discovery-plugin",
        name: "Volatile Discovery Plugin",
      }),
      register(api) {
        api.registerGatewayDiscoveryService({
          marker: "original",
          get id() {
            idReads += 1;
            if (idReads > 1) {
              throw new Error("discovery service id getter re-read");
            }
            return " volatile-discovery ";
          },
          get advertise() {
            advertiseReads += 1;
            if (advertiseReads > 1) {
              throw new Error("discovery service advertise getter re-read");
            }
            return advertise;
          },
        } as OpenClawGatewayDiscoveryService & { marker: string });
      },
    });

    const service = registry.registry.gatewayDiscoveryServices[0]?.service;
    expect(service?.id).toBe("volatile-discovery");
    await service?.advertise(advertiseContext);

    expect(events).toEqual(["original:18789"]);
    expect(idReads).toBe(1);
    expect(advertiseReads).toBe(1);
  });

  it("ignores same-plugin duplicate discovery services before reading advertise", () => {
    let duplicateAdvertiseReads = 0;
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "duplicate-discovery-plugin",
        name: "Duplicate Discovery Plugin",
      }),
      register(api) {
        api.registerGatewayDiscoveryService({
          id: "duplicate-discovery",
          advertise: () => {},
        });
        api.registerGatewayDiscoveryService({
          id: "duplicate-discovery",
          get advertise() {
            duplicateAdvertiseReads += 1;
            throw new Error("duplicate advertise should not be read");
          },
        } as OpenClawGatewayDiscoveryService);
      },
    });

    expect(registry.registry.gatewayDiscoveryServices).toHaveLength(1);
    expect(registry.registry.gatewayDiscoveryServices[0]?.service.id).toBe("duplicate-discovery");
    expect(duplicateAdvertiseReads).toBe(0);
  });
});
