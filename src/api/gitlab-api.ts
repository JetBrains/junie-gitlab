import {
    AccessTokenSchema, AccessTokenScopes,
    ExpandedGroupSchema,
    ExpandedMergeRequestSchema,
    Gitlab, IssueNoteSchema, PipelineTriggerTokenSchema, PipelineVariableSchema,
    ProjectHookSchema, ProjectSchema, UserSchema
} from '@gitbeaker/rest';
import {webhookEnv} from "../webhook-env.js";
import {AccessTokenExposedSchema, IssueSchema} from "@gitbeaker/core";
import {logger} from "../utils/logging.js";
import {withRetry} from "../utils/retry.js";
import * as fs from 'fs';
import {Blob} from 'buffer';

export let api = new Gitlab({
    host: webhookEnv.apiV4Url.value ? (new URL(webhookEnv.apiV4Url.value)).origin : 'https://gitlab.com',
    token: webhookEnv.gitlabToken.value ?? '',
});

if (webhookEnv.apiV4Url.value) {
    logger.info(`Using GitLab API host: ${(new URL(webhookEnv.apiV4Url.value)).origin}`);
}

export function initApi(host: string, token: string) {
    api = new Gitlab({ host, token });
}

export function getIssue(projectId: number, issueId: number): Promise<IssueSchema> {
    logger.debug(`Fetching issue ${issueId} from the project ${projectId}`);
    return withRetry(() => api.Issues.show(issueId, {projectId}), `issue ${issueId}`);
}

export async function addIssueComment(projectId: number, issueId: number, body: string): Promise<IssueNoteSchema> {
    logger.debug(`Adding comment to issue ${issueId} in project ${projectId}`);
    return withRetry(() => api.IssueNotes.create(projectId, issueId, body), `issue comment ${issueId}`);
}

export async function addIssueCommentEmoji(projectId: number, issueId: number, noteId: number, emoji: string) {
    await withRetry(
        () => api.IssueNoteAwardEmojis.award(projectId, issueId, noteId, emoji),
        `emoji ${emoji} on comment ${noteId} in issue ${issueId}`
    );
}

export async function getMergeRequest(projectId: number, mergeRequestId: number): Promise<ExpandedMergeRequestSchema> {
    logger.debug(`Fetching merge request ${mergeRequestId} from project ${projectId}`);
    return withRetry(() => api.MergeRequests.show(projectId, mergeRequestId), `MR ${mergeRequestId}`);
}

export async function addMergeRequestNote(
    projectId: number,
    mergeRequestId: number,
    body: string
) {
    logger.debug(`Adding note to merge request ${mergeRequestId} in project ${projectId}`);
    return withRetry(
        () => api.MergeRequestNotes.create(projectId, mergeRequestId, body),
        `note in MR ${mergeRequestId}`
    );
}

export async function addMergeRequestDiscussionNote(
    projectId: number,
    mergeRequestId: number,
    discussionId: string,
    body: string
) {
    logger.debug(`Adding note to discussion ${discussionId} in merge request ${mergeRequestId} of project ${projectId}`);
    return withRetry(
        () => api.MergeRequestDiscussions.addNote(projectId, mergeRequestId, discussionId, body),
        `discussion note ${discussionId} in MR ${mergeRequestId}`
    );
}

export async function createMergeRequest(
    projectId: number,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string
) {
    logger.debug(`Creating merge request in project ${projectId} from ${sourceBranch} to ${targetBranch}`);
    return withRetry(
        () => api.MergeRequests.create(projectId, sourceBranch, targetBranch, title, { description }),
        `create MR from ${sourceBranch} to ${targetBranch}`
    );
}

export async function deletePipeline(projectId: number, pipelineId: number): Promise<void> {
    logger.debug(`Deleting pipeline ${pipelineId} from project ${projectId}`);
    return withRetry(() => api.Pipelines.remove(projectId, pipelineId), `delete pipeline ${pipelineId}`);
}

export async function runPipeline(
    projectId: number,
    ref: string,
    variables: PipelineVariableSchema[]
) {
    logger.debug(`Running pipeline for project ${projectId} on ref ${ref} with variables: ${JSON.stringify(variables || {})}`);
    return withRetry(
        () => api.Pipelines.create(projectId, ref, { variables }),
        `run pipeline on ${ref}`
    );
}

async function getAllPaginated<T>(
    fetchFn: (page: number, perPage: number) => Promise<T[]>,
    resourceName: string
): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
        const response = await withRetry(
            () => fetchFn(page, perPage),
            `fetch page ${page} of ${resourceName}`
        );
        if (!response || response.length === 0) {
            break;
        }
        items.push(...response);
        if (response.length < perPage) {
            break;
        }
        page++;
    }
    logger.debug(`Retrieved ${items.length} ${resourceName}`);
    return items;
}

export async function getAllProjectAccessTokens(projectId: number): Promise<AccessTokenSchema[]> {
    logger.debug(`Fetching all project access tokens for project ${projectId}`);
    return getAllPaginated(
        (page, perPage) => api.ProjectAccessTokens.all(projectId, { page, perPage }),
        'project access tokens'
    );
}

export async function getAllGroupAccessTokens(groupId: number): Promise<AccessTokenSchema[]> {
    logger.debug(`Fetching all group access tokens for group ${groupId}`);
    try {
        return await getAllPaginated(
            (page, perPage) => api.GroupAccessTokens.all(groupId, { page, perPage }),
            'group access tokens'
        )
    } catch (e: any) {
        logger.debug(`Failed to fetch group access tokens: ${e.message}`);
        return [];
    }
}

export async function getUserById(userId: number): Promise<UserSchema> {
    logger.debug(`Fetching user ${userId}`);
    return withRetry(() => api.Users.show(userId), `user ${userId}`);
}

export async function getProjectById(projectId: number): Promise<ProjectSchema> {
    logger.debug(`Fetching project ${projectId}`);
    return withRetry(() => api.Projects.show(projectId), `project ${projectId}`);
}

export async function getGroupById(groupId: number): Promise<ExpandedGroupSchema> {
    logger.debug(`Fetching group ${groupId}`);
    return withRetry(() => api.Groups.show(groupId), `group ${groupId}`);
}

export async function recursivelyGetAllProjectTokens(projectId: number): Promise<AccessTokenSchema[]> {
    logger.debug(`Recursively fetching all tokens for project ${projectId}`);
    const allTokens: AccessTokenSchema[] = [];

    // Load all project tokens
    const projectTokens = await getAllProjectAccessTokens(projectId);
    allTokens.push(...projectTokens);
    logger.debug(`Found ${projectTokens.length} project tokens`);

    // Get project metadata to resolve parent group
    const project = await getProjectById(projectId);

    if (!project.namespace || project.namespace.kind !== 'group') {
        logger.debug(`Project ${projectId} has no parent group`);
        return allTokens;
    }

    let currentGroupId: number | null = project.namespace.id;

    // Traverse up the group hierarchy
    while (currentGroupId !== null) {
        try {
            logger.debug(`Fetching tokens for group ${currentGroupId}`);
            const groupTokens = await getAllGroupAccessTokens(currentGroupId);
            allTokens.push(...groupTokens);
            logger.debug(`Found ${groupTokens.length} tokens in group ${currentGroupId}`);

            // Get group metadata to check for parent
            const group = await getGroupById(currentGroupId);
            currentGroupId = group.parent_id ?? null;

            if (currentGroupId) {
                logger.debug(`Group has parent group ${currentGroupId}, continuing traversal`);
            } else {
                logger.debug(`Reached root group, stopping traversal`);
            }
        } catch (error: any) {
            if (error.response?.status === 403 || error.cause?.code === 403) {
                logger.debug(`Insufficient permissions to access group ${currentGroupId}, stopping traversal`);
                break;
            }
            throw error;
        }
    }

    logger.debug(`Total tokens collected: ${allTokens.length}`);
    return allTokens;
}

export async function getAllProjectHooks(projectId: number): Promise<ProjectHookSchema[]> {
    logger.debug(`Fetching all webhooks for project ${projectId}`);
    return withRetry(() => api.ProjectHooks.all(projectId), `project hooks for ${projectId}`);
}

export async function createProjectHook(
    projectId: number,
    url: string,
    options: {
        pushEvents?: boolean;
        issuesEvents?: boolean;
        mergeRequestsEvents?: boolean;
        wikiPageEvents?: boolean;
        pipelineEvents?: boolean;
        jobEvents?: boolean;
        token?: string;
        enableSSLVerification?: boolean;
        noteEvents?: boolean;
        customWebhookTemplate?: string;
        description?: string;
        name: string;
        customHeaders?: { key: string; value: string }[];
        urlVariables?: { key: string; value: string }[];
    }
) {
    logger.debug(`Creating webhook for project ${projectId} with URL ${url}`);
    return withRetry(() => api.ProjectHooks.add(projectId, url, options), `create hook for project ${projectId}`);
}

/**
 * Finds the most recent failed pipeline for a merge request
 * Useful for fix-ci feature when triggered via comment (to avoid analyzing the Junie pipeline itself)
 * Skips running/pending pipelines as they might be the current Junie pipeline
 */
export async function getLastCompletedPipelineForMR(projectId: number, mergeRequestId: number) {
    logger.debug(`Fetching pipelines for MR ${mergeRequestId} in project ${projectId}`);

    // Get all pipelines for this MR (already sorted by ID descending - newest first)
    const pipelines = await withRetry(
        () => api.MergeRequests.allPipelines(projectId, mergeRequestId),
        `pipelines for MR ${mergeRequestId}`
    );

    // Find the most recent FAILED pipeline
    // Skip running/pending/created pipelines as they might be the current Junie pipeline
    const failedPipeline = pipelines.find(p => p.status === 'failed');

    if (failedPipeline) {
        logger.debug(`Found failed pipeline ${failedPipeline.id}`);
        return failedPipeline;
    }

    logger.warn(`No failed pipelines found for MR ${mergeRequestId}`);
    return null;
}

export async function getAllPipelineTriggerTokens(projectId: number): Promise<PipelineTriggerTokenSchema[]> {
    logger.debug(`Fetching all pipeline trigger tokens for project ${projectId}`);
    return withRetry(() => api.PipelineTriggerTokens.all(projectId), `pipeline trigger tokens for project ${projectId}`);
}

export async function createPipelineTriggerToken(
    projectId: number,
    description: string
): Promise<PipelineTriggerTokenSchema> {
    logger.debug(`Creating pipeline trigger token for project ${projectId} with description: ${description}`);
    return withRetry(
        () => api.PipelineTriggerTokens.create(projectId, description),
        `create pipeline trigger token for project ${projectId}`
    );
}

export async function deletePipelineTriggerToken(
    projectId: number,
    tokenId: number
): Promise<void> {
    logger.debug(`Deleting pipeline trigger token ${tokenId} from project ${projectId}`);
    return withRetry(
        () => api.PipelineTriggerTokens.remove(projectId, tokenId),
        `delete pipeline trigger token ${tokenId}`
    );
}

export async function createProjectAccessToken(
    projectId: number,
    name: string,
    description: string | undefined,
    scopes: AccessTokenScopes[],
    accessLevel: number,
    expiresAt: string
): Promise<AccessTokenExposedSchema> {
    logger.debug(`Creating project access token "${name}" for project ${projectId} with scopes: ${scopes.join(', ')}`);
    return withRetry(
        () => api.ProjectAccessTokens.create(projectId, name, scopes, expiresAt, { accessLevel, description } as any),
        `create access token "${name}" for project ${projectId}`
    );
}

export async function getProjectCiConfigPath(projectId: number): Promise<string | null> {
    logger.debug(`Fetching CI config path for project ${projectId}`);
    const project = await withRetry(() => api.Projects.show(projectId), `CI config path for project ${projectId}`);
    return (project.ci_config_path as string | null | undefined) ?? null;
}

export async function updateProjectCiConfigPath(
    projectId: number,
    ciConfigPath: string | null,
): Promise<ProjectSchema> {
    logger.debug(`Updating CI config path for project ${projectId} to: ${ciConfigPath}`);
    return withRetry(
        () => api.Projects.edit(projectId, { ciConfigPath } as any),
        `update CI config path for project ${projectId}`
    );
}

export async function deleteIssue(projectId: number, issueIid: number): Promise<void> {
    logger.debug(`Deleting issue ${issueIid} from project ${projectId}`);
    return withRetry(() => api.Issues.remove(projectId, issueIid), `delete issue ${issueIid}`);
}

export async function createIssue(projectId: number, title: string, description: string): Promise<any> {
    logger.debug(`Creating issue "${title}" in project ${projectId}`);
    return withRetry(() => (api.Issues as any).create(projectId, title, { description }), `create issue in project ${projectId}`);
}

export async function getIssueNotes(projectId: number, issueIid: number) {
    logger.debug(`Fetching notes for issue ${issueIid} in project ${projectId}`);
    return withRetry(() => api.IssueNotes.all(projectId, issueIid), `issue notes ${issueIid}`);
}

export async function getIssueNoteEmojis(projectId: number, issueIid: number, noteId: number) {
    logger.debug(`Fetching emojis for note ${noteId} in issue ${issueIid}`);
    return withRetry(() => api.IssueNoteAwardEmojis.all(projectId, issueIid, noteId), `emojis for note ${noteId}`);
}

export async function getMRDiffs(projectId: number, mrIid: number): Promise<{ new_path: string; diff: string }[]> {
    logger.debug(`Fetching diffs for MR ${mrIid} in project ${projectId}`);
    return withRetry(() => api.MergeRequests.allDiffs(projectId, mrIid) as any, `MR diffs ${mrIid}`);
}

export async function closeMergeRequest(projectId: number, mrIid: number) {
    logger.debug(`Closing merge request ${mrIid} in project ${projectId}`);
    return withRetry(() => api.MergeRequests.edit(projectId, mrIid, { stateEvent: 'close' }), `close MR ${mrIid}`);
}

export async function getMRNotes(projectId: number, mrIid: number) {
    logger.debug(`Fetching notes for MR ${mrIid} in project ${projectId}`);
    return withRetry(() => api.MergeRequestNotes.all(projectId, mrIid), `MR notes ${mrIid}`);
}

export async function getMRDiscussions(projectId: number, mrIid: number): Promise<any[]> {
    logger.debug(`Fetching discussions for MR ${mrIid} in project ${projectId}`);
    return withRetry(() => api.MergeRequestDiscussions.all(projectId, mrIid) as any, `MR discussions ${mrIid}`);
}

export async function createBranch(projectId: number, branchName: string, ref: string) {
    logger.debug(`Creating branch ${branchName} from ${ref} in project ${projectId}`);
    return withRetry(() => api.Branches.create(projectId, branchName, ref), `create branch ${branchName}`);
}

export async function deleteBranch(projectId: number, branchName: string): Promise<void> {
    logger.debug(`Deleting branch ${branchName} in project ${projectId}`);
    return withRetry(() => api.Branches.remove(projectId, branchName), `delete branch ${branchName}`);
}

export async function createRepositoryFile(projectId: number, filePath: string, branch: string, content: string, commitMessage: string) {
    logger.debug(`Creating file ${filePath} on branch ${branch} in project ${projectId}`);
    return withRetry(() => api.RepositoryFiles.create(projectId, filePath, branch, content, commitMessage), `create file ${filePath}`);
}

export async function waitForIssueComment(projectId: number, issueIid: number, contentInclude: string, timeoutMs: number = 300000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const notes = await getIssueNotes(projectId, issueIid);
        const found = notes.find(n => n.body.includes(contentInclude));
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error(`Timeout waiting for issue comment containing "${contentInclude}"`);
}

export async function waitForCommentReaction(projectId: number, issueIid: number, noteId: number, emoji: string = 'thumbsup', timeoutMs: number = 120000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const emojis = await getIssueNoteEmojis(projectId, issueIid, noteId);
        if (emojis.some(e => e.name === emoji)) return true;
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error(`Timeout waiting for emoji ${emoji} on issue comment ${noteId}`);
}

export async function waitForMRComment(projectId: number, mrIid: number, contentInclude: string, timeoutMs: number = 300000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const notes = await getMRNotes(projectId, mrIid);
        const found = notes.find(n => n.body.includes(contentInclude));
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error(`Timeout waiting for MR comment containing "${contentInclude}"`);
}

export async function waitForMRFileContent(projectId: number, mrIid: number, filename: string, contentInclude: string, timeoutMs: number = 600000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const files = await getMRDiffs(projectId, mrIid);
        const file = files.find(f => f.new_path === filename);
        if (file?.diff.includes(contentInclude)) return;
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
    throw new Error(`Timeout waiting for "${contentInclude}" in ${filename}`);
}

export async function waitForMRReply(projectId: number, mrIid: number, noteId: number, contentInclude: string, timeoutMs: number = 300000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const discussions = await getMRDiscussions(projectId, mrIid);
        const discussion = discussions.find(d => d.notes?.some((n: any) => n.id === noteId));
        if (discussion) {
            const reply = discussion.notes.find((n: any) => n.id !== noteId && n.body.includes(contentInclude));
            if (reply) return reply;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error(`Timeout waiting for reply to note ${noteId} containing "${contentInclude}"`);
}

export async function checkMergeRequestFiles(projectId: number, mrIid: number, expectedFiles: Record<string, string>) {
    const files = await getMRDiffs(projectId, mrIid);
    for (const [filename, contentSnippet] of Object.entries(expectedFiles)) {
        const fileChange = files.find(f => f.new_path === filename);
        if (!fileChange) return false;
        if (contentSnippet && !fileChange.diff.includes(contentSnippet)) return false;
    }
    return true;
}

export async function getMRTitle(projectId: number, mrIid: number): Promise<string> {
    const mr = await getMergeRequest(projectId, mrIid);
    return (mr as any).title as string;
}

export function findMergeRequestIidFromComment(comment: { body: string }, mrLinkPrefix: string): number {
    const mrLink = comment.body.split(mrLinkPrefix)[1]?.trim() ?? "";
    return parseInt(mrLink.split('/').at(-1) ?? "") || 0;
}

export async function setJunieAvatar(userId: number): Promise<UserSchema> {
    logger.debug(`Setting avatar for user ${userId} from ./assets/junie-logo.png`);
    const avatarPath = '/assets/junie-logo.png';
    const avatarData = fs.readFileSync(avatarPath);
    const data = {
        content: new Blob([avatarData]),
        filename: 'junie-logo.png',
    };
    return withRetry(() => api.Users.edit(userId, { avatar: data }), `set avatar for user ${userId}`);
}
