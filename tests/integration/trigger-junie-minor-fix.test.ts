import { describe, test, before, after } from "node:test";
import assert from "node:assert";
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

const expect = (actual: any, message?: string) => ({
    toBe: (expected: any) => assert.strictEqual(actual, expected, message),
});

describe("Trigger Junie minor-fix in MR comment", () => {
    let defaultBranch: string = 'main';
    let branchName: string | undefined;
    let mrIid: number | undefined;
    let testPassed = false;

    before(async () => {
        console.log(`Using existing project ID: ${projectId}`);
        const projectInfo = await getProjectById(projectId) as any;
        defaultBranch = projectInfo.default_branch || 'main';
        console.log(`Default branch: ${defaultBranch}`);
    });

    after(async () => {
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

    test("apply minor-fix rename to MR based on #junie minor-fix comment", { timeout: 900000 }, async () => {
        const timestamp = Date.now();
        branchName = `feature/string-utils-${timestamp}`;
        const filename = "string_utils.py";
        const originalFunctionName = "process_data";
        const renamedFunctionName = "handle_user_data";
        const content = `def ${originalFunctionName}(items):\n    return [i.strip() for i in items]\n`;

        console.log(`Creating branch: ${branchName}`);
        await createBranch(projectId, branchName, defaultBranch);
        await createRepositoryFile(projectId, filename, branchName, content, "Add string utils");

        const mrTitle = `Add string utilities ${timestamp}`;
        const mr = await createMergeRequest(projectId, branchName, defaultBranch, mrTitle, '');
        mrIid = (mr as any).iid;
        console.log(`MR created: #${mrIid} ${(mr as any).web_url}`);

        const commentBody = `#junie minor-fix rename function ${originalFunctionName} to ${renamedFunctionName} in ${filename}`;
        console.log(`Commenting on MR #${mrIid}: "${commentBody}"`);
        await addMergeRequestNote(projectId, mrIid!, commentBody);

        await waitForMRComment(projectId, mrIid!, JUNIE_STARTED_MESSAGE);
        console.log("Junie started processing.");

        await waitForMRComment(projectId, mrIid!, JUNIE_FINISHED_PREFIX);
        await waitForMRFileContent(projectId, mrIid!, filename, renamedFunctionName);

        const result = await checkMergeRequestFiles(projectId, mrIid!, {
            [filename]: renamedFunctionName,
        });
        expect(result, "MR files check failed - renamed function not found in diff").toBe(true);

        console.log("Junie finished processing the minor-fix.");
        testPassed = true;
    });
});
