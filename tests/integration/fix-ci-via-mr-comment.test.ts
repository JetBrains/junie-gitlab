import {describe, test, before, after} from "node:test";
import {JUNIE_STARTED_MESSAGE, JUNIE_FINISHED_PREFIX} from "../../src/constants/gitlab.js";
import {
    initApi,
    createBranch, deleteBranch, createRepositoryFile,
    createMergeRequest, closeMergeRequest,
    addMergeRequestNote,
    getProjectById,
    waitForFailedPipeline, waitForSuccessfulPipeline,
    waitForMRComment, waitForMRFileNotContains,
    updateProjectCiConfigPath,
} from "../../src/api/gitlab-api.js";
import {gitLabConfig} from "../config/config.js";

const projectId = gitLabConfig.projectId as unknown as number;
initApi(gitLabConfig.gitlabHost, gitLabConfig.gitlabToken);

describe("Fix Failing CI via MR comment", () => {
    let defaultBranch: string = 'main';
    let projectPath: string = '';
    let branchName: string | undefined;
    let mrIid: number | undefined;
    let ciConfigPathSwitched = false;
    let testPassed = false;

    before(async () => {
        console.log(`Using existing project ID: ${projectId}`);
        const projectInfo = await getProjectById(projectId) as any;
        defaultBranch = projectInfo.default_branch || 'main';
        projectPath = projectInfo.path_with_namespace;
        console.log(`Default branch: ${defaultBranch}; project path: ${projectPath}`);
    });

    after(async () => {
        if (ciConfigPathSwitched) {
            try {
                await updateProjectCiConfigPath(projectId, "");
                console.log("Reset ci_config_path to default");
            } catch (e) {
                console.error(`Failed to reset ci_config_path: ${e}`);
            }
        }

        if (testPassed) {
            if (mrIid) {
                try {
                    await closeMergeRequest(projectId, mrIid);
                    console.log(`Closed MR #${mrIid}`);
                } catch (e) {
                    console.error(`Failed to close MR #${mrIid}: ${e}`);
                }
            }
            if (branchName) {
                try {
                    await deleteBranch(projectId, branchName);
                    console.log(`Deleted branch: ${branchName}`);
                } catch (e) {
                    console.error(`Failed to delete branch ${branchName}: ${e}`);
                }
            }
        } else if (mrIid) {
            console.log(`⚠️ Keeping failed test MR: #${mrIid} in project ${projectId} for investigation`);
        }
    });

    test("Junie fixes failing CI on #junie fix-ci comment", {timeout: 1200000}, async () => {
        const timestamp = Date.now();
        branchName = `feature/failing-ci-${timestamp}`;
        const codeFile = "failing-code.js";
        const failingCiPath = "failing-ci.yml";
        const failingCiContent = `spec:
  inputs:
    project_token:
      type: string
      default: ""
---

include:
  - local: .gitlab-ci.yml
    inputs:
      project_token: $[[ inputs.project_token ]]

test:
  stage: cleanup
  image: node:18
  rules:
    - if: $CI_PIPELINE_SOURCE == "push" || $CI_PIPELINE_SOURCE == "merge_request_event"
      when: on_success
    - when: never
  script:
    - node failing-code.js
`;
        const brokenCode = "console.log('fail';\n";

        console.log(`Creating branch: ${branchName}`);
        await createBranch(projectId, branchName, defaultBranch);
        await createRepositoryFile(projectId, failingCiPath, branchName, failingCiContent, "Add failing CI config");
        await createRepositoryFile(projectId, codeFile, branchName, brokenCode, "Add broken code");

        const fullCiConfigPath = `${failingCiPath}@${projectPath}:${branchName}`;
        await updateProjectCiConfigPath(projectId, fullCiConfigPath);
        ciConfigPathSwitched = true;
        console.log(`Switched ci_config_path to: ${fullCiConfigPath}`);

        const mrTitle = `Trigger failing CI ${timestamp}`;
        const mr = await createMergeRequest(projectId, branchName, defaultBranch, mrTitle, '') as any;
        mrIid = mr.iid;
        console.log(`MR created: #${mrIid} ${mr.web_url}`);

        console.log("Waiting for the MR's pipeline to fail...");
        const failedPipeline = await waitForFailedPipeline(projectId, mrIid!);
        console.log(`Found failed pipeline: #${failedPipeline!.id}`);

        const commentBody = `#junie fix-ci`;
        console.log(`Commenting on MR #${mrIid}: "${commentBody}"`);
        await addMergeRequestNote(projectId, mrIid!, commentBody);

        console.log("Waiting for Junie's started comment on MR...");
        await waitForMRComment(projectId, mrIid!, JUNIE_STARTED_MESSAGE);
        console.log("Junie started processing.");

        console.log("Waiting for Junie's finished comment on MR...");
        await waitForMRComment(projectId, mrIid!, JUNIE_FINISHED_PREFIX);
        console.log("Junie posted the finish message.");

        console.log("Verifying the broken code is no longer in the MR diff...");
        await waitForMRFileNotContains(projectId, mrIid!, codeFile, "console.log('fail';");
        console.log("Junie fix detected in MR diff.");

        testPassed = true;
    });
});
