import {describe, test, beforeAll, afterAll, expect} from "bun:test";
import {JUNIE_STARTED_MESSAGE, JUNIE_FINISHED_PREFIX} from "../../src/constants/gitlab.js";
import {
    initApi,
    createIssue, deleteIssue,
    addIssueComment,
    waitForIssueComment, waitForCommentReaction,
    closeMergeRequest, checkMergeRequestFiles,
    findMergeRequestIidFromComment, getMRTitle,
} from "../../src/api/gitlab-api.js";
import {MR_LINK_PREFIX} from "../../src/constants/gitlab.js";
import {gitLabConfig} from "../config/config.js";

const projectId = gitLabConfig.projectId as unknown as number;
initApi(gitLabConfig.gitlabHost, gitLabConfig.gitlabToken);

describe("Trigger Junie in Issue Comment", () => {
    let issueIid: number;
    let testPassed = false;
    let mrIidToClean: number | undefined;

    beforeAll(async () => {
        console.log(`Using existing project ID: ${projectId}`);
    }, 30000);

    afterAll(async () => {
        if (mrIidToClean) {
            try {
                await closeMergeRequest(projectId, mrIidToClean);
                console.log(`Closed MR #${mrIidToClean}`);
            } catch (e) {
                console.error(`Failed to close MR #${mrIidToClean}: ${e}`);
            }
        }

        if (testPassed) {
            if (issueIid) {
                console.log(`Deleting successful test issue: #${issueIid} in project ${projectId}`);
                await deleteIssue(projectId, issueIid);
            }
        } else {
            if (issueIid) {
                console.log(`⚠️ Keeping failed test issue: #${issueIid} in project ${projectId} for investigation`);
            }
        }
    });

    test("create MR via #junie comment on issue", async () => {
        const issueTitle = `Feature Request: Math Utilities ${Date.now()}`;
        const issueBody = "We need some basic math utilities in this project.";
        const filename = "math_ops.ts";
        const functionName = "calculate_factorial";

        console.log(`Creating issue: "${issueTitle}" in project ${projectId}`);
        const issue = await createIssue(projectId, issueTitle, issueBody);
        issueIid = issue.iid;
        console.log(`Issue created: #${issueIid}`);
        console.log(`View issue at: ${issue.web_url}`);

        const commentBody = `#junie please implement a function ${functionName} in a new file ${filename}. The function should return the factorial of n. Also add a README.md file.`;
        console.log(`Commenting on Issue #${issueIid}: "${commentBody}"`);

        const comment = await addIssueComment(projectId, issueIid, commentBody);
        await waitForCommentReaction(projectId, issueIid, comment.id);
        console.log("Junie reacted to the issue comment.");

        await waitForIssueComment(projectId, issueIid, JUNIE_STARTED_MESSAGE);
        console.log("Junie started processing the issue.");

        const foundComment = await waitForIssueComment(projectId, issueIid, JUNIE_FINISHED_PREFIX);
        console.log(`Junie posted the finish message: ${foundComment.body}`);

        const mrIid = findMergeRequestIidFromComment(foundComment, MR_LINK_PREFIX);
        expect(mrIid, "Could not parse MR IID from link").toBeGreaterThan(0);
        mrIidToClean = mrIid;

        const titleKeywords = ["factorial", "math", "README"];
        const title = await getMRTitle(projectId, mrIid);
        console.log(`MR title: ${title}`);
        expect(
            titleKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase())),
            `MR title "${title}" does not contain any of: ${titleKeywords.join(', ')}`
        ).toBe(true);

        const result = await checkMergeRequestFiles(projectId, mrIid, {
            [filename]: functionName,
            "README.md": ""
        });
        expect(result, "MR files check failed - required content not found in files").toBe(true);

        console.log("Junie finished processing the issue.");
        testPassed = true;
    }, 1200000);
});
