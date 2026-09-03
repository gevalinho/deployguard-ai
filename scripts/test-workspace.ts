import {
  createAssessmentWorkspace,
} from "../src/lib/workspace/assessment-workspace";

import {
  prepareAssessmentWorkspace,
} from "../src/lib/agents/workspace-agent";

async function main() {
  console.log(
    "\n=== DeployGuard Isolated Workspace Test ===\n"
  );

  const workspace =
    createAssessmentWorkspace(process.cwd());

  console.log(
    `Workspace: ${workspace.workspacePath}\n`
  );

  try {
    const result =
      await prepareAssessmentWorkspace(
        workspace.workspacePath
      );

    console.log(
      JSON.stringify(result, null, 2)
    );
  } finally {
    workspace.cleanup();

    console.log(
      "\nTemporary workspace removed."
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});