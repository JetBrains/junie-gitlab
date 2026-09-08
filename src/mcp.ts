import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {logger} from "./utils/logging.js";

export function initJunieMcpConfig(gitlabApiUrl: string, gitlabToken: string, projectId: number) {
    logger.info(`Initializing MCP config...`);
    const config = {
        mcpServers: {
            gitlab: {
                command: "npx",
                args: ["-y", "@zereight/mcp-gitlab"],
                env: {
                    GITLAB_DISABLE_VERSION_CHECK: "true",
                    GITLAB_PERSONAL_ACCESS_TOKEN: gitlabToken,
                    GITLAB_API_URL: gitlabApiUrl,
                    GITLAB_READ_ONLY_MODE: "false",
                    USE_GITLAB_WIKI: "false",
                    USE_MILESTONE: "false",
                    USE_PIPELINE: "true",
                    GITLAB_ALLOWED_PROJECT_IDS: `${projectId}`,
                }
            }
        }
    }
    const configJson = JSON.stringify(config, null, 2);

    const configPath = path.join(os.homedir(), '.junie', 'mcp', 'mcp.json');
    const configDir = path.dirname(configPath);

    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, configJson, 'utf8');
    logger.info(`MCP config created at ${configPath}`);
}