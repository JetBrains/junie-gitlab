import {describe, test, beforeAll, afterAll, expect} from "bun:test";
import {JUNIE_STARTED_MESSAGE, JUNIE_FINISHED_PREFIX} from "../../src/constants/gitlab.js";
import {
    initApi,
    createBranch, deleteBranch, createRepositoryFile,
    createMergeRequest, closeMergeRequest,
    addMergeRequestNote,
    waitForMRComment, waitForMRFileContent, checkMergeRequestFiles,
    getProjectById,
} from "../../src/api/gitlab-api.js";
import {gitLabConfig} from "../config/config.js";

const projectId = gitLabConfig.projectId as unknown as number;
initApi(gitLabConfig.gitlabHost, gitLabConfig.gitlabToken);

describe("Trigger Junie in MR comment", () => {
    let defaultBranch: string = 'main';
    let branchName: string | undefined;
    let mrIid: number | undefined;
    let testPassed = false;

    beforeAll(async () => {
        console.log(`Using existing project ID: ${projectId}`);
        const projectInfo = await getProjectById(projectId) as any;
        defaultBranch = projectInfo.default_branch || 'main';
        console.log(`Default branch: ${defaultBranch}`);
    }, 30000);

    afterAll(async () => {
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
        } else {
            if (mrIid) {
                console.log(`⚠️ Keeping failed test MR: #${mrIid} in project ${projectId} for investigation`);
            }
        }
    });

    test("apply changes to MR based on #junie comment", async () => {
        const timestamp = Date.now();
        branchName = `feature/math-utils-${timestamp}`;
        const filename = "math_utils.py";
        const content = "def divide(a, b):\n    return a / b\n";

        console.log(`Creating branch: ${branchName}`);
        await createBranch(projectId, branchName, defaultBranch);
        await createRepositoryFile(projectId, filename, branchName, content, "Add math utils");

        const mrTitle = `Add math utilities ${timestamp}`;
        const mr = await createMergeRequest(projectId, branchName, defaultBranch, mrTitle, '');
        mrIid = (mr as any).iid;
        console.log(`MR created: #${mrIid} ${(mr as any).web_url}`);

        const commentBody = `#junie add error handling to the divide function in ${filename} to handle division by zero. Add README.md`;
        console.log(`Commenting on MR #${mrIid}: "${commentBody}"`);
        await addMergeRequestNote(projectId, mrIid!, commentBody);

        await waitForMRComment(projectId, mrIid!, JUNIE_STARTED_MESSAGE);
        console.log("Junie started processing.");

        await waitForMRComment(projectId, mrIid!, JUNIE_FINISHED_PREFIX);
        await waitForMRFileContent(projectId, mrIid!, filename, "b == 0");

        const result = await checkMergeRequestFiles(projectId, mrIid!, {
            [filename]: "b == 0",
            "README.md": ""
        });
        expect(result, "MR files check failed - required content not found").toBe(true);

        console.log("Junie finished processing.");
        testPassed = true;
    }, 900000);
});
