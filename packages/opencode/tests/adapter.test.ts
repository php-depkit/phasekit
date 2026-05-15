import { describe, expect, test } from "bun:test";

import { corePackageName } from "@phasekit/core";
import { describeOpenCodeAdapter, opencodePackageName } from "../src/adapter";

describe("@phasekit/opencode", () => {
  test("imports @phasekit/core", () => {
    expect(corePackageName).toBe("@phasekit/core");
    expect(describeOpenCodeAdapter()).toEqual({
      name: opencodePackageName,
      core: { name: "@phasekit/core" },
    });
  });
});
