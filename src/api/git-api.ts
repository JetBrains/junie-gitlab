import {simpleGit, StatusResult} from 'simple-git';
import {webhookEnv} from "../webhook-env.js";
import {runCommand} from "../utils/commands.js";
import {logger} from "../utils/logging.js";

const git = simpleGit({
    baseDir: process.cwd(),
});

let gitIsInitialized = false;
async function initGit() {
    if (!gitIsInitialized) {
        await git.init();
        await git.addConfig('user.name', 'Junie', false, 'global');
        await git.addConfig('user.email', 'Junie@jetbrains.com', false, 'global');
        await git.addConfig('safe.directory', process.env.CI_PROJECT_DIR ?? process.cwd(), true, 'global');
        gitIsInitialized = true;
    }
}

export function initializeGitLFS() {
    try {
        runCommand('git lfs env > /dev/null 2>&1');
        runCommand(`chown -R $(whoami) .git || true`);
        runCommand(`chmod -R u+w .git/hooks || true`);
        runCommand(`git lfs update --force`);
        logger.info('Git LFS initialized successfully');
    } catch (error) {
        logger.info('Git LFS not available or initialization skipped');
    }
}

export async function checkoutLocalBranch(branchName: string) {
    await initGit();
    await git.checkoutLocalBranch(branchName);
}

export async function checkoutBranch(projectPath: string, branchName: string) {
    logger.info(`Checking out branch ${branchName} from project ${projectPath}`);
    await initGit();
    await setRemoteIfNeeded(projectPath);
    await git.fetch('origin', branchName);
    await git.checkout(branchName);
}

export async function addAllToGit() {
    await initGit();
    await git.add([
        '-A',
        ':!$ENV_FILE',
        ':!*.orig',
        ':!*.rej',
        ':!*.class',
        ':!.junie',
    ]);
}

export async function commitGitChanges(message: string) {
    await initGit();
    await git.commit(message);
}

export async function pushGitChanges(projectPath: string, branch: string) {
    await initGit();
    await setRemoteIfNeeded(projectPath);
    await git.push('origin', branch);
    logger.info(`Push completed`);
}

export async function checkForChanges(): Promise<StatusResult> {
    await initGit();
    const status = await git.status();
    logger.info(`Found ${status.files.length} file(s) with changes`);
    if (status.files.length > 0) {
        status.files.forEach(file => {
            logger.info(`  [index: '${file.index}', working: '${file.working_dir}'] ${file.path}`);
        });
    }
    return status;
}

let remoteIsSet = false;
async function setRemoteIfNeeded(projectPath: string) {
    if (remoteIsSet) return;
    const remoteUrl = `${process.env.CI_SERVER_PROTOCOL}://oauth2:${webhookEnv.gitlabToken.value!}@${process.env.CI_SERVER_HOST}/${projectPath}.git`;
    const remotes = await git.getRemotes();
    if (remotes.find(r => r.name === 'origin')) {
        await git.remote(['set-url', 'origin', remoteUrl]);
    } else {
        await git.addRemote('origin', remoteUrl);
    }
    remoteIsSet = true;
    logger.info(`Git remote set to ${remoteUrl}`);
}
