import {writeFile, mkdir} from "fs/promises";
import {join} from "path";
import {logger} from "./logging.js";

const DOWNLOAD_DIR = "/tmp/gitlab-attachments";

/**
 * Download file from GitLab using direct HTTP request
 * GitLab uploads are accessible via: https://gitlab.host/-/project/{id}/uploads/hash/filename
 * We construct the URL and authenticate with PRIVATE-TOKEN header
 */
async function downloadFile(
    projectId: number,
    originalPath: string,
    gitlabHost: string,
    gitlabToken: string
): Promise<string> {
    try {
        // Extract filename from path
        const filename = originalPath.split('/').pop() || `attachment-${Date.now()}`;

        // originalPath already includes /uploads/hash/filename
        // GitLab uploads are accessible via: /-/project/{id}/uploads/{hash}/{filename}
        const url = `${gitlabHost}/-/project/${projectId}${originalPath}`;

        logger.debug(`Downloading from: ${url}`);

        const response = await fetch(url, {
            headers: {
                'PRIVATE-TOKEN': gitlabToken,
                'User-Agent': 'junie-gitlab'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await mkdir(DOWNLOAD_DIR, {recursive: true});

        const localPath = join(DOWNLOAD_DIR, filename);
        await writeFile(localPath, buffer);

        logger.debug(`✓ Downloaded: ${originalPath} -> ${localPath}`);
        return localPath;
    } catch (error: any) {
        logger.error(`Failed to download ${originalPath}: ${error.message}`);
        throw error;
    }
}

/**
 * Extract all GitLab upload URLs from markdown text
 * Matches pattern: /uploads/hash/filename.ext
 *
 * Returns set of unique upload paths for deduplication
 */
function extractUploadsFromMarkdown(text: string): Set<string> {
    const uploadsSet = new Set<string>();

    // Simple pattern: /uploads/hash/filename
    const uploadPattern = /\/uploads\/[a-zA-Z0-9]+\/[^)\s"']+/gi;
    const matches = text.matchAll(uploadPattern);

    for (const match of matches) {
        uploadsSet.add(match[0]); // "/uploads/abc123/image.png"
    }

    if (uploadsSet.size > 0) {
        logger.debug(`Found ${uploadsSet.size} unique upload(s)`);
    }

    return uploadsSet;
}

/**
 * Download attachments from GitLab markdown and get a map of original paths to local paths.
 *
 * @param text - Markdown text containing GitLab upload references
 * @param projectId - GitLab project ID
 * @param gitlabHost - GitLab host (origin from apiV4Url)
 * @param gitlabToken - GitLab API token
 * @returns Map of original paths to local file paths
 */
export async function downloadAttachmentsFromMarkdown(
    text: string,
    projectId: number,
    gitlabHost: string,
    gitlabToken: string
): Promise<Map<string, string>> {
    // Extract all unique upload paths
    const uploadPaths = extractUploadsFromMarkdown(text);
    const downloadedMap = new Map<string, string>();

    if (uploadPaths.size === 0) {
        return downloadedMap;
    }

    // Download each unique file once
    for (const originalPath of uploadPaths) {
        try {
            const localPath = await downloadFile(projectId, originalPath, gitlabHost, gitlabToken);
            downloadedMap.set(originalPath, localPath);
        } catch (error: any) {
            logger.warn(`Could not download ${originalPath}: ${error.message}`);
            // Continue with other attachments
        }
    }

    if (downloadedMap.size > 0) {
        logger.info(`Successfully downloaded ${downloadedMap.size} unique file(s)`);
    }

    return downloadedMap;
}

/**
 * Replace upload URLs in text with local paths
 */
export function replaceAttachmentsInText(text: string, urlMap: Map<string, string>): string {
    let updatedText = text;

    for (const [originalPath, localPath] of urlMap) {
        // Escape special regex characters in the original path
        const escapedPath = originalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        updatedText = updatedText.replace(new RegExp(escapedPath, 'g'), localPath);
    }

    return updatedText;
}

/**
 * Process markdown text: download attachments and replace URLs with local paths
 * This is a convenience function that combines download and replace operations
 *
 * @param text - Markdown text to process
 * @param projectId - GitLab project ID
 * @param gitlabHost - GitLab host (origin from apiV4Url)
 * @param gitlabToken - GitLab API token
 * @returns Processed text with local file paths
 */
export async function processMarkdownAttachments(
    text: string | null | undefined,
    projectId: number,
    gitlabHost: string,
    gitlabToken: string
): Promise<string> {
    if (!text) {
        return "";
    }

    try {
        const attachmentsMap = await downloadAttachmentsFromMarkdown(
            text,
            projectId,
            gitlabHost,
            gitlabToken
        );

        if (attachmentsMap.size === 0) {
            return text;
        }

        return replaceAttachmentsInText(text, attachmentsMap);
    } catch (error: any) {
        logger.error(`Failed to process markdown attachments: ${error.message}`);
        return text; // Return original text if processing fails
    }
}
