import {runCommand} from "./utils/commands.js";
import {
    createMergeRequest,
    deletePipeline,
    getIssue,
    getMergeRequest,
    getUserById,
    recursivelyGetAllProjectTokens
} from "./api/gitlab-api.js";
import {
    addAllToGit,
    checkForChanges,
    checkoutBranch,
    checkoutLocalBranch,
    commitGitChanges,
    pushGitChanges
} from "./api/git-api.js";
import {
    FailedTaskExtractionResult,
    IssueCommentTask,
    MergeRequestCommentTask,
    MergeRequestEventTask,
    TaskExtractionResult
} from "./models/task-extraction-result.js";
import {submitFeedback} from "./feedback.js";
import {logger} from "./utils/logging.js";
import {initJunieMcpConfig} from "./mcp.js";
import {
    GitLabExecutionContext,
    isIssueCommentEvent,
    isMergeRequestCommentEvent,
    isMergeRequestEvent
} from "./context.js";

const cacheDir = "/junieCache";

export async function execute(context: GitLabExecutionContext) {
    const taskExtractionResult = await extractTaskFromEnv(context);

    if (taskExtractionResult.success) {
        logger.info('Installing Junie CLI...');
        const output = runCommand('npm i -g @jetbrains/junie-cli' + (context.junieVersion ? '@' + context.junieVersion : ''));
        logger.info(output.trim());

        logger.info(`Using MCP: ${context.useMcp ? 'yes' : 'no'}`);
        if (context.useMcp) {
            initJunieMcpConfig(context.apiV4Url, context.gitlabToken, context.projectId);
        }

        const executionStartFeedback = taskExtractionResult.generateExecutionStartedFeedback();
        for (const feedback of executionStartFeedback) {
            await submitFeedback(feedback);
        }

        // checkout another branch if needed:
        const branchToPull = taskExtractionResult.checkoutBranch;
        if (branchToPull) {
            logger.info(`Checking out the branch ${branchToPull}`)
            await checkoutBranch(branchToPull);
        }

        const resultJson = runJunie(taskExtractionResult.generateJuniePrompt(context.useMcp), context.junieApiKey, context.junieModel, context.junieGuidelinesFilename);
        logger.debug("Full output: " + resultJson.trim());
        const result = JSON.parse(resultJson);

        const outcome: string | null = result["result"] ?? null;
        const taskName: string | null = result["taskName"] ?? null;

        logger.info("Execution result: " + outcome);

        const commitMessage = `generated changes by Junie: ${taskName ?? 'task completed'}`;

        let createdMrUrl: string | null = null;

        if ((taskExtractionResult instanceof MergeRequestCommentTask || taskExtractionResult instanceof MergeRequestEventTask)
            && context.cliOptions.mrMode === "append"
            && branchToPull) {
            await pushChangesToTheSameBranch(
                branchToPull,
                commitMessage,
            );
        } else {
            let targetBranch = context.defaultBranch;
            if (taskExtractionResult instanceof MergeRequestCommentTask || taskExtractionResult instanceof MergeRequestEventTask) {
                targetBranch = taskExtractionResult.checkoutBranch;
            }
            if (!targetBranch) {
                throw new Error("Can't determine target branch for merge request");
            }
            createdMrUrl = await pushChangesAsMergeRequest(
                context.projectId,
                taskExtractionResult.getTitle(),
                taskExtractionResult.generateMrIntro(outcome),
                commitMessage,
                targetBranch,
            );
        }

        const executionFinishedFeedback = taskExtractionResult.generateExecutionFinishedFeedback(outcome, taskName, createdMrUrl);
        for (const feedback of executionFinishedFeedback) {
            await submitFeedback(feedback);
        }

        // TODO: ?
    } else {
        logger.info(`No task detected: ${taskExtractionResult.reason}`);
        if (context.cliOptions.cleanupAfterIdleRun) {
            await cleanup(context.projectId, context.pipelineId);
        } else {
            logger.info("Auto-cleanup disabled and will be skipped");
        }
    }
}

async function extractTaskFromEnv(context: GitLabExecutionContext): Promise<TaskExtractionResult> {
    const {projectId, junieBotTaggingPattern, cliOptions: {customPrompt}} = context;

    // Issue comment event
    if (isIssueCommentEvent(context)) {
        const hasMention = await checkTextForJunieMention(projectId, context.commentText, junieBotTaggingPattern);
        if (!hasMention) {
            return new FailedTaskExtractionResult("Comment doesn't contain mention to Junie");
        }
        const issue = await getIssue(projectId, context.issueId);
        return new IssueCommentTask(
            context,
            {
                title: issue.title,
                description: issue.description,
            }
        );
    }

    // MR comment event
    if (isMergeRequestCommentEvent(context)) {
        const hasMention = await checkTextForJunieMention(projectId, context.commentText, junieBotTaggingPattern);
        if (!hasMention) {
            return new FailedTaskExtractionResult("Comment doesn't contain mention to Junie");
        }
        const mergeRequest = await getMergeRequest(projectId, context.mergeRequestId);
        return new MergeRequestCommentTask(
            context,
            {
                title: mergeRequest.title,
                description: mergeRequest.description ?? "(empty description)",
                web_url: mergeRequest.web_url,
            }
        );
    }

    // MR event (open, update, reopen)
    if (isMergeRequestEvent(context)) {
        // Only trigger actions if custom prompt is set
        if (customPrompt) {
            return new MergeRequestEventTask(context);
        } else {
            return new FailedTaskExtractionResult(`MR event action '${context.mrEventAction}' no custom prompt set`);
        }
    }
    // This should never happen due to exhaustive type checking in extractGitLabContext
    return new FailedTaskExtractionResult(`Unsupported event: ${JSON.stringify(context)}`);
}

function runJunie(prompt: string, apiKey: string, model: string | null, guidelinesFilename: string | null): string {
    const token = apiKey;
    runCommand(`mkdir -p ${cacheDir}`);
    logger.debug(`Running Junie with prompt: '${prompt}'`);
    try {
        const extraEnv = [
            {
                key: "EJ_TASK",
                value: prompt,
            }
        ];
        const modelArg = model ? ` --model="${model}"` : "";
        const guidelinesArg = guidelinesFilename ? ` --guidelines-file="${guidelinesFilename}"` : "";
        return runCommand(
            `junie --auth "${token}" --cache-dir="${cacheDir}" --output-format="json"${modelArg}${guidelinesArg}`,
            extraEnv,
        );
    } catch (e) {
        logger.error("Failed to run Junie", e);
        throw e;
    }
}

async function cleanup(projectId: number, pipelineId: number) {
    logger.info('Cleaning up...');
    await deletePipeline(projectId, pipelineId);
}

async function stageAndLogChanges() {
    await addAllToGit();

    logger.info('Git status:');
    const status = await checkForChanges();
    status.files.forEach(file => logger.info(`- [${file.index}] ${file.path}`));
    return status.files.filter(file => file.index !== ' ' && file.index !== '?');
}

async function pushChangesAsMergeRequest(
    projectId: number,
    mrTitle: string,
    mrDescription: string,
    commitMessage: string,
    mergeTargetBranch: string,
): Promise<string | null> {
    const stagedChanges = await stageAndLogChanges();
    if (stagedChanges.length === 0) {
        logger.warn('No changes to commit');
        return null;
    }

    const branchName = `test-${Date.now()}`;
    logger.info(`Changes will be pushed to a new branch ${branchName} and a merge request will be created.`)
    // initializeGitLFS();

    await checkoutLocalBranch(branchName);

    await commitGitChanges(commitMessage);
    await pushGitChanges(branchName);

    const mr = await createMergeRequest(
        projectId,
        branchName,
        mergeTargetBranch,
        mrTitle,
        mrDescription,
    );
    return mr.web_url;
}

async function pushChangesToTheSameBranch(
    branchName: string,
    commitMessage: string,
) {
    const stagedChanges = await stageAndLogChanges();
    if (stagedChanges.length === 0) {
        logger.warn('No changes to commit');
        return;
    }
    logger.info(`Changes will be pushed to the current branch ${branchName}.`);
    // initializeGitLFS();

    await commitGitChanges(commitMessage);
    await pushGitChanges(branchName);
}

async function checkTextForJunieMention(
    projectId: number,
    text: string,
    botTaggingPattern: RegExp,
): Promise<boolean> {
    if (text.toLowerCase().includes('@junie')) {
        logger.info('Detected literal junie mention');
        return true;
    }
    const regex = /@(project|group)_[-a-zA-Z0-9_]+/g;
    const matches = Array.from(text.matchAll(regex));
    const tokens = await recursivelyGetAllProjectTokens(projectId);
    const filteredTokens = tokens
        .filter(token => token.active && !token.revoked)
        .filter(token => botTaggingPattern.test(token.name));
    for (const token of filteredTokens) {
        const user = await getUserById(token.user_id);
        if (matches.some(match => match[0].includes(user.username))) {
            logger.info(`Detected mention to '${user.username}' (token '${token.name}')`);
            return true;
        }
    }
    return false;
}
