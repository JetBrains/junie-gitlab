import {
    AccessTokenSchema, AccessTokenScopes,
    ExpandedGroupSchema,
    ExpandedMergeRequestSchema,
    Gitlab, IssueNoteSchema, PipelineTriggerTokenSchema,
    ProjectHookSchema, ProjectSchema, UserSchema
} from '@gitbeaker/rest';
import {webhookEnv} from "../webhook-env.js";
import {AccessTokenExposedSchema, IssueSchema} from "@gitbeaker/core";
import {logger} from "../utils/logging.js";

const apiHost = (new URL(webhookEnv.apiV4Url.value!)).origin;
const token = webhookEnv.gitlabToken.value!;
logger.info(`Using GitLab API host: ${apiHost}`);

export const api = new Gitlab({
    host: apiHost,
    token: token,
});

export function getIssue(projectId: number, issueId: number): Promise<IssueSchema> {
    logger.debug(`Fetching issue ${issueId} from the project ${projectId}`);
    return api.Issues.show(issueId, {projectId});
}

export async function addIssueComment(projectId: number, issueId: number, body: string): Promise<IssueNoteSchema> {
    logger.debug(`Adding comment to issue ${issueId} in project ${projectId}`);
    return await api.IssueNotes.create(projectId, issueId, body);
}

export async function addIssueCommentEmoji(projectId: number, issueId: number, noteId: number, emoji: string) {
    await api.IssueNoteAwardEmojis.award(
        projectId,
        issueId,
        noteId,
        emoji,
    )
}

export async function getMergeRequest(projectId: number, mergeRequestId: number): Promise<ExpandedMergeRequestSchema> {
    logger.debug(`Fetching merge request ${mergeRequestId} from project ${projectId}`);
    return api.MergeRequests.show(projectId, mergeRequestId);
}

export async function addMergeRequestNote(
    projectId: number,
    mergeRequestId: number,
    body: string
) {
    logger.debug(`Adding note to merge request ${mergeRequestId} in project ${projectId}`);
    return await api.MergeRequestNotes.create(projectId, mergeRequestId, body);
}

export async function addMergeRequestDiscussionNote(
    projectId: number,
    mergeRequestId: number,
    discussionId: string,
    body: string
) {
    logger.debug(`Adding note to discussion ${discussionId} in merge request ${mergeRequestId} of project ${projectId}`);
    return await api.MergeRequestDiscussions.addNote(projectId, mergeRequestId, discussionId, body);
}

export async function createMergeRequest(
    projectId: number,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string
) {
    logger.debug(`Creating merge request in project ${projectId} from ${sourceBranch} to ${targetBranch}`);
    return await api.MergeRequests.create(
        projectId,
        sourceBranch,
        targetBranch,
        title,
        {
            description,
        }
    );
}

export async function deletePipeline(projectId: number, pipelineId: number): Promise<void> {
    logger.debug(`Deleting pipeline ${pipelineId} from project ${projectId}`);
    return await api.Pipelines.remove(projectId, pipelineId);
}

async function getAllPaginated<T>(
    fetchFn: (page: number, perPage: number) => Promise<T[]>,
    resourceName: string
): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
        const response = await fetchFn(page, perPage);
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
    return await api.Users.show(userId);
}

export async function getProjectById(projectId: number): Promise<ProjectSchema> {
    logger.debug(`Fetching project ${projectId}`);
    return await api.Projects.show(projectId);
}

export async function getGroupById(groupId: number): Promise<ExpandedGroupSchema> {
    logger.debug(`Fetching group ${groupId}`);
    return await api.Groups.show(groupId);
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
    return api.ProjectHooks.all(projectId);
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
    return await api.ProjectHooks.add(projectId, url, options);
}

/**
 * Finds the most recent failed pipeline for a merge request
 * Useful for fix-ci feature when triggered via comment (to avoid analyzing the Junie pipeline itself)
 * Skips running/pending pipelines as they might be the current Junie pipeline
 */
export async function getLastCompletedPipelineForMR(projectId: number, mergeRequestId: number) {
    logger.debug(`Fetching pipelines for MR ${mergeRequestId} in project ${projectId}`);

    // Get all pipelines for this MR (already sorted by ID descending - newest first)
    const pipelines = await api.MergeRequests.allPipelines(projectId, mergeRequestId);

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
    return await api.PipelineTriggerTokens.all(projectId);
}

export async function createPipelineTriggerToken(
    projectId: number,
    description: string
): Promise<PipelineTriggerTokenSchema> {
    logger.debug(`Creating pipeline trigger token for project ${projectId} with description: ${description}`);
    return await api.PipelineTriggerTokens.create(projectId, description);
}

export async function deletePipelineTriggerToken(
    projectId: number,
    tokenId: number
): Promise<void> {
    logger.debug(`Deleting pipeline trigger token ${tokenId} from project ${projectId}`);
    return await api.PipelineTriggerTokens.remove(projectId, tokenId);
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
    return await api.ProjectAccessTokens.create(projectId, name, scopes, expiresAt, { accessLevel, description } as any);
}