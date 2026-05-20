import { describe, test, before, after } from "node:test";
import assert from "node:assert";
import {JUNIE_STARTED_MESSAGE, JUNIE_FINISHED_PREFIX, MR_LINK_PREFIX} from "../../src/constants/gitlab.js";
import {
    initApi,
    createIssue,
    addIssueComment,
    waitForIssueComment, waitForCommentReaction,
    waitForMergeRequestFiles, checkMergeRequestFiles,
    findMergeRequestIidFromComment, getMRTitle,
} from "../../src/api/gitlab-api.js";
import {gitLabConfig} from "../config/config.js";
import {LocalGitLabFixture} from "../fixtures/local-gitlab-fixture.js";

const expect = (actual: any, message?: string) => ({
    toBeGreaterThan: (expected: number) => assert.ok(actual > expected, message),
    toBe: (expected: any) => assert.strictEqual(actual, expected, message),
});

describe("Trigger Junie in Issue Comment", () => {
    const fixture = new LocalGitLabFixture();
    let projectId: number;
    let issueIid: number;
    let testPassed = false;

    before(async () => {
        initApi(gitLabConfig.gitlabHost, gitLabConfig.gitlabToken);
        const handle = await fixture.create("test-issue-comment");
        projectId = handle.projectId;
        console.log(`Created isolated project #${projectId} (${handle.webUrl})`);
    });

    after(async () => {
        await fixture.destroy({testPassed});
    });

    test("create MR via #junie comment on issue", { timeout: 1200000 }, async () => {
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
        const titleKeywords = ["factorial", "math", "README"];
        const title = await getMRTitle(projectId, mrIid);
        console.log(`MR title: ${title}`);
        expect(
            titleKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase())),
            `MR title "${title}" does not contain any of: ${titleKeywords.join(', ')}`
        ).toBe(true);
        await waitForMergeRequestFiles(projectId, mrIid, filename);
        const result = await checkMergeRequestFiles(projectId, mrIid, {
            [filename]: functionName,
            "README.md": ""
        });
        expect(result, "MR files check failed - required content not found in files").toBe(true);
        console.log("Junie finished processing the issue.");
        testPassed = true;
    });
});
