/**
 * Sanitizer for preventing prompt injection attacks in user-submitted content.
 *
 * Protects against:
 * - Hidden HTML comments with malicious instructions
 * - Invisible Unicode characters (zero-width, control chars)
 * - Text direction manipulation (right-to-left override)
 * - Hidden attributes (alt, title, aria-label, data-*)
 * - HTML entity obfuscation
 * - GitLab token exposure
 */

/**
 * Remove HTML comments that could contain hidden instructions
 * Pattern: <!-- anything -->
 */
function stripHtmlComments(content: string): string {
    return content.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Remove invisible characters that could be used for obfuscation
 * Includes:
 * - Zero-width characters (U+200B, U+200C, U+200D, U+FEFF)
 * - Control characters (U+0000-U+001F, U+007F-U+009F)
 * - Soft hyphens (U+00AD)
 * - Unicode direction marks (U+202A-U+202E, U+2066-U+2069)
 */
function stripInvisibleCharacters(content: string): string {
    // Zero-width characters
    content = content.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");

    // Control characters (excluding tab \u0009, newline \u000A, carriage return \u000D)
    content = content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");

    // Soft hyphens
    content = content.replace(/\u00AD/g, "");

    // Unicode direction marks (can be used to reverse text visually)
    content = content.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");

    return content;
}

/**
 * Remove alt text from markdown images
 * Pattern: ![alt text](url) -> ![](url)
 */
function stripMarkdownImageAltText(content: string): string {
    return content.replace(/!\[[^\]]*\]\(/g, "![](");
}

/**
 * Remove title attributes from markdown links
 * Pattern: [text](url "title") -> [text](url)
 */
function stripMarkdownLinkTitles(content: string): string {
    // Double quotes
    content = content.replace(/(\[[^\]]*\]\([^)]+)\s+"[^"]*"\)/g, "$1)");
    // Single quotes
    content = content.replace(/(\[[^\]]*\]\([^)]+)\s+'[^']*'\)/g, "$1)");
    return content;
}

/**
 * Remove HTML attributes that could contain hidden instructions
 * Strips: alt, title, aria-label, data-*, placeholder
 */
function stripHiddenAttributes(content: string): string {
    // alt attributes
    content = content.replace(/\salt\s*=\s*["'][^"']*["']/gi, "");
    content = content.replace(/\salt\s*=\s*[^\s>]+/gi, "");

    // title attributes
    content = content.replace(/\stitle\s*=\s*["'][^"']*["']/gi, "");
    content = content.replace(/\stitle\s*=\s*[^\s>]+/gi, "");

    // aria-label attributes
    content = content.replace(/\saria-label\s*=\s*["'][^"']*["']/gi, "");
    content = content.replace(/\saria-label\s*=\s*[^\s>]+/gi, "");

    // data-* attributes (custom attributes)
    content = content.replace(/\sdata-[a-zA-Z0-9-]+\s*=\s*["'][^"']*["']/gi, "");
    content = content.replace(/\sdata-[a-zA-Z0-9-]+\s*=\s*[^\s>]+/gi, "");

    // placeholder attributes
    content = content.replace(/\splaceholder\s*=\s*["'][^"']*["']/gi, "");
    content = content.replace(/\splaceholder\s*=\s*[^\s>]+/gi, "");

    return content;
}

/**
 * Normalize HTML entities to prevent obfuscation
 * Decodes &#72; (decimal) and &#x48; (hex) to actual characters
 * Only keeps printable ASCII characters (32-126)
 */
function normalizeHtmlEntities(content: string): string {
    // Decode numeric decimal entities (&#72; = 'H')
    content = content.replace(/&#(\d+);/g, (_, dec) => {
        const num = parseInt(dec, 10);
        // Only decode printable ASCII range
        if (num >= 32 && num <= 126) {
            return String.fromCharCode(num);
        }
        // Remove non-printable entities
        return "";
    });

    // Decode hex entities (&#x48; = 'H')
    content = content.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        const num = parseInt(hex, 16);
        // Only decode printable ASCII range
        if (num >= 32 && num <= 126) {
            return String.fromCharCode(num);
        }
        // Remove non-printable entities
        return "";
    });

    return content;
}

/**
 * Redact GitLab tokens to prevent accidental exposure
 * Detects GitLab token formats:
 * - glpat- (Personal Access Tokens)
 * - gldt- (Deploy Tokens)
 * - GR13- (Runner Registration Tokens)
 */
function redactGitLabTokens(content: string): string {
    // Personal Access Tokens
    content = content.replace(/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TOKEN]");

    // Deploy Tokens
    content = content.replace(/\bgldt-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TOKEN]");

    // Runner Registration Tokens
    content = content.replace(/\bGR13[A-Za-z0-9]{20,}\b/g, "[REDACTED_TOKEN]");

    return content;
}

/**
 * Master sanitization function that applies all security measures
 * Use this function to sanitize any user-submitted content before including in prompts
 */
export function sanitizeContent(content: string | null | undefined): string {
    if (!content) {
        return "";
    }

    let sanitized = content;

    // Apply all sanitization steps in sequence
    sanitized = stripHtmlComments(sanitized);
    sanitized = stripInvisibleCharacters(sanitized);
    sanitized = stripMarkdownImageAltText(sanitized);
    sanitized = stripMarkdownLinkTitles(sanitized);
    sanitized = stripHiddenAttributes(sanitized);
    sanitized = normalizeHtmlEntities(sanitized);
    sanitized = redactGitLabTokens(sanitized);

    return sanitized;
}
