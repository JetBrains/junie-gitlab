import {Gitlab} from '@gitbeaker/rest';
import {
    DiscussionSchema,
    CommitSchema,
    ExpandedMergeRequestSchema,
    IssueSchema,
    MergeRequestDiffSchema
} from '@gitbeaker/core';
import {logger} from "../utils/logging.js";

export type FetchedData = {
    mergeRequest?: ExpandedMergeRequestSchema;
    issue?: IssueSchema;
    commits?: CommitSchema[];
    discussions?: DiscussionSchema[];
    changes?: MergeRequestDiffSchema[];
};

/**
 * GitLab data fetcher - fetches all necessary context for prompts
 */
export class GitLabDataFetcher {
    constructor(private api: Gitlab) {}

    /**
     * Fetch all MR data including commits, discussions, and changes
     */
    async fetchMergeRequestData(
        projectId: number,
        mergeRequestIid: number,
        triggerTime?: string
    ): Promise<FetchedData> {
        logger.debug(`Fetching MR data for project ${projectId}, MR ${mergeRequestIid}`);

        try {
            // Fetch all data in parallel
            const [mergeRequest, commits, discussions, changes] = await Promise.all([
                this.api.MergeRequests.show(projectId, mergeRequestIid),
                this.api.MergeRequests.allCommits(projectId, mergeRequestIid),
                this.api.MergeRequestDiscussions.all(projectId, mergeRequestIid),
                this.api.MergeRequests.allDiffs(projectId, mergeRequestIid),
            ]);

            // Filter discussions by trigger time if provided
            const filteredDiscussions = triggerTime
                ? this.filterDiscussionsByTime(discussions, triggerTime)
                : discussions;

            logger.debug(`Fetched MR data: ${commits.length} commits, ${filteredDiscussions.length} discussions, ${changes.length} changed files`);

            return {
                mergeRequest,
                commits,
                discussions: filteredDiscussions,
                changes,
            };
        } catch (error: any) {
            logger.error(`Failed to fetch MR data: ${error.message}`);
            throw error;
        }
    }

    /**
     * Fetch all Issue data including discussions
     */
    async fetchIssueData(
        projectId: number,
        issueIid: number,
        triggerTime?: string
    ): Promise<FetchedData> {
        logger.debug(`Fetching Issue data for project ${projectId}, Issue ${issueIid}`);

        try {
            // Fetch all data in parallel
            const [issue, discussions] = await Promise.all([
                this.api.Issues.show(issueIid, { projectId }),
                this.api.IssueDiscussions.all(projectId, issueIid),
            ]);

            // Filter discussions by trigger time if provided
            const filteredDiscussions = triggerTime
                ? this.filterDiscussionsByTime(discussions, triggerTime)
                : discussions;

            logger.debug(`Fetched Issue data: ${filteredDiscussions.length} discussions`);

            return {
                issue,
                discussions: filteredDiscussions,
            };
        } catch (error: any) {
            logger.error(`Failed to fetch Issue data: ${error.message}`);
            throw error;
        }
    }

    /**
     * Filter discussions to only include those created before or at trigger time
     */
    private filterDiscussionsByTime(
        discussions: DiscussionSchema[],
        triggerTime: string
    ): DiscussionSchema[] {
        const triggerDate = new Date(triggerTime);

        return discussions
            .map(discussion => ({
                ...discussion,
                notes: discussion.notes?.filter(note => {
                    const noteDate = new Date(note.created_at);
                    return noteDate <= triggerDate;
                }) ?? []
            }))
            .filter(discussion => discussion.notes && discussion.notes.length > 0);
    }
}
