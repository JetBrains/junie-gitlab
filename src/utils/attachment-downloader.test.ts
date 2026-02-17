/**
 * Simple tests for attachment downloader
 * These are basic unit tests to verify the extraction logic
 */

// Mock the dependencies
const mockLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
};

// Test: Extract uploads from markdown
function testExtractUploads() {
    const markdown = `
# Test Document

Here's an image: ![screenshot](/uploads/abc123def/screenshot.png)

And a file: [document.pdf](/uploads/xyz789/document.pdf)

Full URL: https://gitlab.com/namespace/project/uploads/123abc/image.jpg
    `;

    // This would normally be imported from the module
    // For now, just verify the regex patterns work

    const relativePattern = /\/uploads\/([a-zA-Z0-9]+\/[^)\s"']+)/gi;
    const matches = [...markdown.matchAll(relativePattern)];

    console.log('Test: Extract relative upload URLs');
    console.log(`Found ${matches.length} matches`);

    if (matches.length !== 3) {
        console.error(`❌ Expected 3 matches, got ${matches.length}`);
        return false;
    }

    console.log('✓ Extraction test passed');
    return true;
}

// Test: URL replacement
function testUrlReplacement() {
    const text = "Check this image: /uploads/abc123/image.png";
    const replacements = new Map([
        ["/uploads/abc123/image.png", "/tmp/gitlab-attachments/image.png"]
    ]);

    let result = text;
    for (const [original, local] of replacements) {
        const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'g'), local);
    }

    console.log('\nTest: URL replacement');
    console.log('Original:', text);
    console.log('Result:', result);

    if (!result.includes('/tmp/gitlab-attachments/image.png')) {
        console.error('❌ Replacement failed');
        return false;
    }

    console.log('✓ Replacement test passed');
    return true;
}

// Test: Deduplication
function testDeduplication() {
    const markdown = `
Same file in different formats:
- Relative: /uploads/abc123/file.png
- Full URL: https://gitlab.com/namespace/project/uploads/abc123/file.png
- Another mention: /uploads/abc123/file.png
    `;

    // Extract using the combined pattern
    const uploadPattern = /(?:https?:\/\/[^\/]+\/[^\/]+\/[^\/]+)?\/uploads\/([a-zA-Z0-9]+\/[^)\s"']+)/gi;
    const matches = [...markdown.matchAll(uploadPattern)];

    console.log('\nTest: Deduplication');
    console.log(`Found ${matches.length} total matches`);

    // Group by uploadPath
    const grouped = new Map();
    for (const match of matches) {
        const uploadPath = match[1];
        if (!grouped.has(uploadPath)) {
            grouped.set(uploadPath, []);
        }
        grouped.get(uploadPath).push(match[0]);
    }

    console.log(`Unique files: ${grouped.size}`);
    console.log(`Upload path: ${Array.from(grouped.keys())[0]}`);
    console.log(`References: ${grouped.get(Array.from(grouped.keys())[0]).length}`);

    if (grouped.size !== 1) {
        console.error('❌ Expected 1 unique file');
        return false;
    }

    if (grouped.get('abc123/file.png').length !== 3) {
        console.error('❌ Expected 3 references to the same file');
        return false;
    }

    console.log('✓ Deduplication test passed');
    return true;
}

// Run tests
console.log('Running attachment downloader tests...\n');
const test1 = testExtractUploads();
const test2 = testUrlReplacement();
const test3 = testDeduplication();

if (test1 && test2 && test3) {
    console.log('\n✅ All tests passed!');
} else {
    console.log('\n❌ Some tests failed');
    process.exit(1);
}
