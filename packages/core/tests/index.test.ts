import { describe, expect, test } from "bun:test";

import { corePackageName, describeCorePackage } from "../src/index";

describe("@phasekit/core", () => {
  test("exports minimal package metadata", () => {
    expect(corePackageName).toBe("@phasekit/core");
    expect(describeCorePackage()).toEqual({ name: "@phasekit/core" });
  });
});
