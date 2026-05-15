import { describe, expect, test } from "bun:test";

import { describeInstallPackage, installPackageName } from "../src/index";

describe("@phasekit/install", () => {
  test("exports minimal package metadata", () => {
    expect(installPackageName).toBe("@phasekit/install");
    expect(describeInstallPackage()).toEqual({ name: "@phasekit/install" });
  });
});
