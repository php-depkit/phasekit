import { join } from "node:path";

import { readJsonFile } from "../state/json";
import { rulesStateSchema } from "../state/schema";
import { generateAgentsMd, type AgentsMdProjectContext } from "./agents-md";
import { writeGeneratedArtifact, type WriteGeneratedArtifactResult } from "./write";

export type GenerateAgentsMdArtifactOptions = {
  rootDir?: string;
  projectContext: AgentsMdProjectContext;
};

/** Reads canonical rules state and writes deterministic managed AGENTS.md. */
export async function generateAgentsMdArtifact(
  options: GenerateAgentsMdArtifactOptions,
): Promise<WriteGeneratedArtifactResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const rulesState = await readJsonFile(join(rootDir, ".planning", "rules.json"), rulesStateSchema);
  const content = generateAgentsMd({ rulesState, projectContext: options.projectContext });

  return writeGeneratedArtifact({
    rootDir,
    path: "AGENTS.md",
    content,
  });
}
