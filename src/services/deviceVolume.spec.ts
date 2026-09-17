import { describe, expect, it } from "vitest";
import { getDeviceVolume, setDeviceVolume } from "./deviceVolume";

describe("deviceVolume", () => {
  it("saves and retrieves device volume, returns null for unknown devices", () => {
    setDeviceVolume("device-a", 0.5);
    expect(getDeviceVolume("device-a")).toBe(0.5);
    expect(getDeviceVolume("device-unknown")).toBeNull();
  });

  it("clamps out-of-range values between 0 and 1 on read", () => {
    setDeviceVolume("device-clamp", 2);
    expect(getDeviceVolume("device-clamp")).toBe(1);
    setDeviceVolume("device-clamp-neg", -0.5);
    expect(getDeviceVolume("device-clamp-neg")).toBe(0);
  });

  it("evicts oldest records when capacity exceeds threshold", async () => {
    setDeviceVolume("device-old", 0.1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let index = 0; index < 30; index++) {
      setDeviceVolume(`device-extra-${index}`, 0.2);
    }
    expect(getDeviceVolume("device-old")).toBeNull();
    expect(getDeviceVolume("device-extra-29")).toBe(0.2);
  });
});
