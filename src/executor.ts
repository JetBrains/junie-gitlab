import {runCommand} from "./utils/commands.js";
import {
    createMergeRequest,
    getUserById,
    recursivelyGetAllProjectTokens,
    api, getProjectCiConfigPath, getProjectById, updateProjectCiConfigPath, runPipeline
} from "./api/gitlab-api.js";
import {execSync} from "child_process";
import * as fs from "fs";
import {GitLabDataFetcher} from "./api/gitlab-data-fetcher.js";
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
    IssueCommentTask, JunieTask,
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
import {writeToFile} from "./utils/io.js";
import {Variable, webhookEnv} from "./webhook-env.js";
import {PipelineVariableSchema} from "@gitbeaker/rest";

const cacheDir = "/junieCache";
const literalMentions = ['@junie', '#junie'];

export async function execute(context: GitLabExecutionContext) {
    const taskExtractionResult = await extractTaskFromEnv(context);

    if (taskExtractionResult.success) {

        /**
         * Handle pipeline redirection logic.
         * If usePipelineRedirect is set to true – it will trigger a pipeline in a user-project instead of continuing
         * its execution in the current project.
         */
        if (context.usePipelineRedirect && context.projectId !== context.junieProjectId) {
            logger.info(`Redirecting pipeline to Junie project ${context.junieProjectId}`);
            const originalCiSource = await getProjectCiConfigPath(context.projectId);
            logger.info(`Original CI config path: ${originalCiSource ? `"${originalCiSource}"` : "[none]"}`);
            const currentProject = await getProjectById(context.junieProjectId);
            const targetProject = await getProjectById(context.projectId);
            const filePath = `child-pipeline.yml@${currentProject.path_with_namespace}`;
            await updateProjectCiConfigPath(context.projectId, filePath);
            try {
                const variables: PipelineVariableSchema[] = [];
                Object.keys(webhookEnv).forEach(key => {
                    const value = (webhookEnv as any)[key];
                    if (value instanceof Variable && value.mappedValue !== null) {
                        variables.push({key: value.key, value: value.value});
                    }
                });
                variables.push({
                    key: webhookEnv.junieApiKey.key,
                    value: webhookEnv.junieApiKey.value!,
                });
                variables.push({
                    key: webhookEnv.gitlabToken.key,
                    value: webhookEnv.gitlabToken.value!,
                });
                await runPipeline(
                    targetProject.id,
                    targetProject.default_branch, // ?
                    variables,
                );
            } catch (e) {
                logger.error("Failed to redirect pipeline", e);
            } finally {
                await updateProjectCiConfigPath(context.projectId, originalCiSource);
            }
            return;
        }

        const projectPath = context.projectPathWithNamespace;
        logger.info('Installing Junie CLI...');
        const output = runCommand('npm i -g @jetbrains/junie-cli' + (context.junieVersion ? '@' + context.junieVersion : ''));
        logger.info(output.trim());

        // Configure glab authentication
        try {
            const parsedUrl = new URL(context.apiV4Url);
            const glabHost = parsedUrl.host;
            const glabProtocol = parsedUrl.protocol.replace(':', ''); // 'http' or 'https'
            logger.info(`Configuring glab authentication for ${glabProtocol}://${glabHost}`);
            execSync(`echo "${context.gitlabToken}" | glab auth login --hostname ${glabHost} --stdin`, {stdio: 'inherit'});
            execSync(`glab config set --host ${glabHost} api_protocol ${glabProtocol}`, {stdio: 'pipe'});
            const authCheckOutput = execSync(`glab api user --hostname ${glabHost}`, { stdio: 'pipe' }).toString();
            const { username, name } = JSON.parse(authCheckOutput);
            logger.info(`glab authentication configured successfully. Current user: ${username} (${name})`);
        } catch (error) {
            logger.error("Failed to configure glab authentication:", error);
        }

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
        await checkoutBranch(projectPath, branchToPull);

        const junieTask = await taskExtractionResult.generateJuniePrompt(context.useMcp);
        const resultJson = runJunie(junieTask, context.junieApiKey, context.junieModel, context.junieGuidelinesFilename);
        logger.debug("Full output: " + resultJson.trim());
        const result = JSON.parse(resultJson);

        const outcome: string | null = result["result"] ?? null;
        const taskName: string | null = result["taskName"] ?? null;

        logger.info("Execution result: " + outcome);

        const commitMessage = `generated changes by Junie: ${taskName ?? 'task completed'}`;

        let createdMrUrl: string | null = null;

        if ((taskExtractionResult instanceof MergeRequestCommentTask || taskExtractionResult instanceof MergeRequestEventTask)
            && context.cliOptions.mrMode === "append"
            && branchToPull !== context.defaultBranch) {
            await pushChangesToTheSameBranch(
                projectPath,
                branchToPull,
                commitMessage,
            );
        } else {
            createdMrUrl = await pushChangesAsMergeRequest(
                context.projectId,
                projectPath,
                taskExtractionResult.getTitle(),
                taskExtractionResult.generateMrIntro(outcome),
                commitMessage,
                branchToPull,
            );
        }

        const executionFinishedFeedback = taskExtractionResult.generateExecutionFinishedFeedback(outcome, taskName, createdMrUrl);
        for (const feedback of executionFinishedFeedback) {
            await submitFeedback(feedback);
        }

        // TODO: ?
    } else {
        logger.info(`No task detected: ${taskExtractionResult.reason}`);
        /**
         * During the "cleanup" stage of a GitLab pipeline, the wrapper will delete a current running pipeline in case
         * there is an environment variable DELETE_PIPELINE set to 'true':
         */
        writeToFile(`${cacheDir}/wrapper-outputs.env`, "DELETE_PIPELINE=true");
    }
}

async function extractTaskFromEnv(context: GitLabExecutionContext): Promise<TaskExtractionResult> {
    const {projectId, junieBotTaggingPattern, customPrompt} = context;
    const dataFetcher = new GitLabDataFetcher(api);

    // Issue comment event
    if (isIssueCommentEvent(context)) {
        const hasMention = await checkTextForJunieMention(projectId, context.commentText, junieBotTaggingPattern);
        if (!hasMention) {
            return new FailedTaskExtractionResult("Comment doesn't contain mention to Junie");
        }

        // Fetch rich issue data with discussions
        logger.debug('Fetching rich issue data...');
        const fetchedData = await dataFetcher.fetchIssueData(projectId, context.issueId);

        return new IssueCommentTask(
            context,
            fetchedData,
            context.defaultBranch,
        );
    }

    // MR comment event
    if (isMergeRequestCommentEvent(context)) {
        const hasMention = await checkTextForJunieMention(projectId, context.commentText, junieBotTaggingPattern);
        if (!hasMention) {
            return new FailedTaskExtractionResult("Comment doesn't contain mention to Junie");
        }

        // Fetch rich MR data with commits, discussions, and changes
        logger.debug('Fetching rich MR data...');
        const fetchedData = await dataFetcher.fetchMergeRequestData(projectId, context.mergeRequestId);

        return new MergeRequestCommentTask(
            context,
            fetchedData
        );
    }

    // MR event (open, update, reopen)
    if (isMergeRequestEvent(context)) {
        // Only trigger actions if custom prompt is set
        if (customPrompt) {
            // Fetch rich MR data with commits, discussions, and changes
            logger.debug('Fetching rich MR data for event...');
            const fetchedData = await dataFetcher.fetchMergeRequestData(projectId, context.mrEventId);

            return new MergeRequestEventTask(context, fetchedData);
        } else {
            return new FailedTaskExtractionResult(`MR event action '${context.mrEventAction}' no custom prompt set`);
        }
    }
    // This should never happen due to exhaustive type checking in extractGitLabContext
    return new FailedTaskExtractionResult(`Unsupported event: ${JSON.stringify(context)}`);
}

function runJunie(junieTask: JunieTask, apiKey: string, model: string | null, guidelinesFilename: string | null): string {
    const token = apiKey;
    runCommand(`mkdir -p ${cacheDir}`);
    logger.debug(`Running Junie with task (length: ${junieTask.task?.length ?? 0})`);

    // Write task to file to avoid ARG_MAX limit for large prompts
    const junieInputFile = `${cacheDir}/junie_input.json`;
    const junieOutputFile = `${cacheDir}/junie_output.json`;

    fs.writeFileSync(junieInputFile, JSON.stringify(junieTask, null, 2));
    logger.debug(`Junie input written to: ${junieInputFile}`);

    try {
        const modelArg = model ? ` --model="${model}"` : "";
        const guidelinesArg = guidelinesFilename ? ` --guidelines-file="${guidelinesFilename}"` : "";

        // Read from file via stdin to avoid ARG_MAX limit
        runCommand(
            `junie --auth "${token}" --cache-dir="${cacheDir}" --output-format="json" --input-format="json" --json-output-file="${junieOutputFile}"${modelArg}${guidelinesArg} < "${junieInputFile}"`,
        );

        // Read output from file
        const output = fs.readFileSync(junieOutputFile, 'utf-8');
        logger.debug(`Junie output read from: ${junieOutputFile}`);
        return output;
    } catch (e) {
        logger.error("Failed to run Junie", e);
        throw e;
    }
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
    projectPath: string,
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
    await pushGitChanges(projectPath, branchName);

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
    projectPath: string,
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
    await pushGitChanges(projectPath, branchName);
}

async function checkTextForJunieMention(
    projectId: number,
    text: string,
    botTaggingPattern: RegExp,
): Promise<boolean> {
    if (literalMentions.some(mention => text.toLowerCase().includes(mention.toLowerCase()))) {
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
