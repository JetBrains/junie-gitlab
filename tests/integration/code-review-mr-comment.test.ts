import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {JUNIE_STARTED_MESSAGE, JUNIE_FINISHED_PREFIX} from "../../src/constants/gitlab.js";
import {
    initApi,
    createBranch, deleteBranch, createRepositoryFile,
    createMergeRequest, closeMergeRequest,
    addMergeRequestNote,
    waitForMRComment,
    waitForMRInlineNotes, getMRInlineNotes,
    getProjectById,
} from "../../src/api/gitlab-api.js";
import {gitLabConfig} from "../config/config.js";

const projectId = gitLabConfig.projectId as unknown as number;
initApi(gitLabConfig.gitlabHost, gitLabConfig.gitlabToken);

describe("Code Review", () => {
    test("on-demand via '#junie code-review' comment", {timeout: 900_000},
        () => runCodeReviewTest('ondemand', '#junie code-review'));

    test("automatic on MR open", {timeout: 900_000},
        () => runCodeReviewTest('auto'));
});

async function runCodeReviewTest(suffix: string, triggerComment?: string) {
    const timestamp = Date.now();
    const branchName = `feature/${suffix}-${timestamp}`;
    const projectInfo = await getProjectById(projectId) as any;
    const defaultBranch = projectInfo.default_branch || 'main';

    let mrIid: number | undefined;
    let passed = false;
    try {
        console.log(`[${suffix}] Creating branch ${branchName} from ${defaultBranch}...`);
        await createBranch(projectId, branchName, defaultBranch);
        await createRepositoryFile(projectId, `src/app_${suffix}.py`, branchName,
            "def avg(arr:\n    total = sum(arr)\n    return total / len(arr) if arr else 0\n",
            `Add code for ${suffix}`);
        await createRepositoryFile(projectId, `src/stats_${suffix}.py`, branchName,
            "def multiply(a, b:\n    return a * b\n",
            `Add stats for ${suffix}`);

        console.log(`[${suffix}] Opening MR...`);
        const mr = await createMergeRequest(projectId, branchName, defaultBranch,
            `Code review ${suffix} ${timestamp}`, '');
        mrIid = (mr as any).iid;
        console.log(`[${suffix}] MR #${mrIid}: ${(mr as any).web_url}`);

        if (triggerComment) {
            console.log(`[${suffix}] Posting trigger comment: "${triggerComment}"`);
            await addMergeRequestNote(projectId, mrIid!, triggerComment);
        } else {
            console.log(`[${suffix}] No comment posted — waiting for auto-trigger on MR open.`);
        }

        console.log(`[${suffix}] Waiting for Junie to start...`);
        await waitForMRComment(projectId, mrIid!, JUNIE_STARTED_MESSAGE);
        console.log(`[${suffix}] Junie started. Waiting for ≥2 inline notes...`);
        await waitForMRInlineNotes(projectId, mrIid!, 2);

        const notes = await getMRInlineNotes(projectId, mrIid!, n => {
            const body = (n.body || "") as string;
            return body.includes("multiply(a, b") || body.includes("avg(arr");
        });
        assert.ok(notes.length >= 2,
            `Expected more or equal than 2 inline notes, got ${notes.length}:\n${notes.map(n => n.body).join('\n---\n')}`);

        console.log(`[${suffix}] Got ${notes.length} inline notes. Waiting for finish message...`);
        await waitForMRComment(projectId, mrIid!, JUNIE_FINISHED_PREFIX);
        console.log(`[${suffix}] Junie finished code review.`);
        passed = true;
    } finally {
        if (passed && mrIid) {
            await closeMergeRequest(projectId, mrIid).catch(e => console.error(`Close MR: ${e}`));
            await deleteBranch(projectId, branchName).catch(e => console.error(`Delete branch: ${e}`));
        } else if (mrIid) {
            console.log(`⚠️ Keeping failed test MR #${mrIid} for investigation`);
        }
    }
}
