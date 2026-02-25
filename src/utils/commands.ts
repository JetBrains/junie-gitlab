import {execSync} from "child_process";
import {logger} from "./logging.js";

export function runCommand(command: string, env?: {key: string, value: string}[]): string {
    try {
        logger.debug(`Running command: ${command}`);

        let execEnv: NodeJS.ProcessEnv;
        if (env && env.length > 0) {
            execEnv = {...process.env};
            for (const {key, value} of env) {
                execEnv[key] = value;
            }
        } else {
            execEnv = process.env;
        }

        return execSync(command, {
            encoding: 'utf-8',
            stdio: 'pipe',
            env: execEnv
        });
    } catch (error: any) {
        logger.error(error.stdout || error.message);
        throw error;
    }
}
