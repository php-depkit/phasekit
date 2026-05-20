import { describe, expect, test } from "bun:test";

import { corePackageName, describeCorePackage } from "../src/index";

describe("@depkit/phasekit-core", () => {
  test("exports minimal package metadata", () => {
    expect(corePackageName).toBe("@depkit/phasekit-core");
    expect(describeCorePackage()).toEqual({ name: "@depkit/phasekit-core" });
  });
});
