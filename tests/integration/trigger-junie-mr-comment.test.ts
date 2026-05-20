import { describe, test, before, after } from "node:test";
import assert from "node:assert";
import {JUNIE_STARTED_MESSAGE, JUNIE_FINISHED_PREFIX} from "../../src/constants/gitlab.js";
import {
    initApi,
    createBranch, createRepositoryFile,
    createMergeRequest,
    addMergeRequestNote,
    waitForMRComment, waitForMRFileContent, waitForMergeRequestFiles, checkMergeRequestFiles,
} from "../../src/api/gitlab-api.js";
import {gitLabConfig} from "../config/config.js";
import {LocalGitLabFixture} from "../fixtures/local-gitlab-fixture.js";

const expect = (actual: any, message?: string) => ({
    toBe: (expected: any) => assert.strictEqual(actual, expected, message),
});

describe("Trigger Junie in MR comment", () => {
    const fixture = new LocalGitLabFixture();
    let projectId: number;
    let defaultBranch: string;
    let mrIid: number | undefined;
    let testPassed = false;

    before(async () => {
        initApi(gitLabConfig.gitlabHost, gitLabConfig.gitlabToken);
        const handle = await fixture.create("test-mr-comment", "--mr-mode append");
        projectId = handle.projectId;
        defaultBranch = handle.defaultBranch;
        console.log(`Created isolated project #${projectId} (${handle.webUrl}), default branch: ${defaultBranch}`);
    });

    after(async () => {
        await fixture.destroy({testPassed});
    });

    test("apply changes to MR based on #junie comment", { timeout: 900000 }, async () => {
        const timestamp = Date.now();
        const branchName = `feature/math-utils-${timestamp}`;
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

        await waitForMergeRequestFiles(projectId, mrIid!, filename);
        const result = await checkMergeRequestFiles(projectId, mrIid!, {
            [filename]: "b == 0",
            "README.md": ""
        });
        expect(result, "MR files check failed - required content not found").toBe(true);

        console.log("Junie finished processing.");
        testPassed = true;
    });
});
