import {Command, Option} from 'commander';
import {createRequire} from 'module';
import {execute} from "./executor.js";
import {initialize} from "./initializer.js";
import {logger} from "./utils/logging.js";
import {extractGitLabContext} from "./context.js";
import {webhookEnv} from "./webhook-env.js";
import {deletePipeline} from "./api/gitlab-api.js";

const require = createRequire(import.meta.url);
const pkg: { version?: string } = require('../package.json');

const program = new Command();

program
    .name('gitlab-cli-wrapper')
    .description('Wrapper for Junie CLI for GitLab environment')
    .version(pkg.version ?? '0.0.0');

program
    .command('init')
    .description('Initialize Junie CLI')
    .option('-V, --verbose', 'Enable verbose logging', false)
    .allowUnknownOption()
    .action(async (opts, cmd) => {
        const verbose: boolean = opts.verbose ?? false;
        if (verbose) {
            logger.level = 'debug';
        }

        // try to parse project ids from the rest of a command:
        const restArgs: string[] = cmd.args;
        const projectIds = restArgs
            .join(",")
            .replaceAll(" ", ",")
            .split(",")
            .map(id => parseInt(id));

        if (projectIds.length === 0) {
            throw new Error("No project ids provided. Please specify at least one project id as a command line argument");
        }

        await initialize(projectIds);
    });

program
    .command('run')
    .description('Run Junie CLI')
    .option('-V, --verbose', 'Enable verbose logging', false)
    .option('-p, --prompt <prompt>', 'Custom prompt for Junie execution')
    .addOption(
        new Option('-M --mr-mode <mode>', 'Merge requests processing mode ("append" or "new")')
            .choices(['append', 'new'])
            .default('new')
    )
    .action(async (opts) => {
        const verbose: boolean = opts.verbose ?? false;
        const mrMode: 'append' | 'new' = opts.mrMode ?? 'new';
        const customPrompt: string | undefined = opts.prompt;
        if (verbose) {
            logger.level = 'debug';
        }

        // Extract GitLab context from environment and CLI options
        const context = await extractGitLabContext({
            mrMode: mrMode,
            customPrompt: customPrompt ?? null,
        });

        execute(context).then(() => {
            logger.info('Execution finished successfully');
        });
    });

program
    .command('cleanup')
    .description('Cleanup')
    .action(async () => {
        const currentProjectId = webhookEnv.junieProjectId.value!;
        const pipelineId = webhookEnv.pipelineId.value!;
        await deletePipeline(currentProjectId, pipelineId);
    });

program.parseAsync(process.argv);
