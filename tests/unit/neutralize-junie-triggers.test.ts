import {describe, test} from "node:test";
import assert from "node:assert";
import {neutralizeJunieTriggers} from "../../src/utils/sanitizer.js";

const expect = (actual: any) => ({
    toBe: (expected: any) => assert.strictEqual(actual, expected),
    not: {
        toContain: (expected: string) => assert.ok(!actual.includes(expected)),
    },
    toContain: (expected: string) => assert.ok(actual.includes(expected)),
});

/**
 * Unit tests for `neutralizeJunieTriggers`.
 *
 * These tests must stay in lock-step with the GitLab CI/CD `rules:` regexes
 * in `script-sample.yaml` and `child-pipeline.yml`:
 *   - /#junie(\s|$)/i
 *   - /@project_[0-9]+_bot/i
 *
 * Together with the regexes in `sanitizer.ts` they guarantee that no outgoing
 * note posted by Junie itself can re-trigger the GitLab pipeline (the
 * recursion bug from the original ticket: a summary like
 * "...in response to #junie rereview this pls..." used to fire a new
 * pipeline because the rule matches raw text and ignores the comment author).
 */

// Re-implementation of the GitLab-side rules for self-checking the result.
const GITLAB_JUNIE_RULE = /#junie(\s|$)/i;
const GITLAB_BOT_MENTION_RULE = /@project_[0-9]+_bot/i;

describe("neutralizeJunieTriggers", () => {
    describe("falsy input", () => {
        test("given null when neutralized then returns empty string", () => {
            expect(neutralizeJunieTriggers(null)).toBe("");
        });

        test("given undefined when neutralized then returns empty string", () => {
            expect(neutralizeJunieTriggers(undefined)).toBe("");
        });

        test("given empty string when neutralized then returns empty string", () => {
            expect(neutralizeJunieTriggers("")).toBe("");
        });
    });

    describe("#junie trigger", () => {
        test("given verbatim '#junie ' echo when neutralized then GitLab rule no longer matches", () => {
            const original = "Re-reviewed MR !6337 in response to #junie rereview this pls in discussion thread";
            const result = neutralizeJunieTriggers(original);

            expect(result).not.toContain("#junie ");
            expect(GITLAB_JUNIE_RULE.test(result)).toBe(false);
        });

        test("given '#junie' at end of string when neutralized then GitLab rule no longer matches", () => {
            const result = neutralizeJunieTriggers("end of line: #junie");
            expect(GITLAB_JUNIE_RULE.test(result)).toBe(false);
        });

        test("given '#JUNIE' uppercase when neutralized then case-insensitive rule no longer matches", () => {
            const result = neutralizeJunieTriggers("Hi #JUNIE please review");
            expect(GITLAB_JUNIE_RULE.test(result)).toBe(false);
        });

        test("given multiple '#junie' occurrences when neutralized then all are replaced", () => {
            const result = neutralizeJunieTriggers("#junie hello #junie world");
            expect(GITLAB_JUNIE_RULE.test(result)).toBe(false);
            // both occurrences replaced
            expect(result.includes("#junie ")).toBe(false);
        });

        test("given '#juniePR' (no word boundary) when neutralized then text is left unchanged because GitLab rule also does not match", () => {
            // GitLab rule is /#junie(\s|$)/i — '#juniePR' is not a trigger;
            // we MUST NOT rewrite it (would corrupt unrelated text).
            const original = "look at #juniePR-123 for details";
            const result = neutralizeJunieTriggers(original);
            expect(result).toBe(original);
            expect(GITLAB_JUNIE_RULE.test(original)).toBe(false);
        });
    });

    describe("@project_<id>_bot mention", () => {
        test("given '@project_123_bot' when neutralized then GitLab mention rule no longer matches", () => {
            const result = neutralizeJunieTriggers("ping @project_123_bot please");
            expect(GITLAB_BOT_MENTION_RULE.test(result)).toBe(false);
        });

        test("given numbered bot suffix '@project_123_bot2' when neutralized then GitLab mention rule no longer matches", () => {
            const result = neutralizeJunieTriggers("ping @project_123_bot2 please");
            expect(GITLAB_BOT_MENTION_RULE.test(result)).toBe(false);
        });

        test("given uppercase '@PROJECT_123_BOT' when neutralized then rule (case-insensitive) no longer matches", () => {
            const result = neutralizeJunieTriggers("ping @PROJECT_123_BOT please");
            expect(GITLAB_BOT_MENTION_RULE.test(result)).toBe(false);
        });
    });

    describe("code fences", () => {
        test("given trigger inside ``` fence when neutralized then fence content is preserved as-is", () => {
            const original = "see example:\n```\n#junie do this\n@project_42_bot\n```\nend";
            const result = neutralizeJunieTriggers(original);

            expect(result).toContain("```\n#junie do this\n@project_42_bot\n```");
        });

        test("given trigger outside fence and inside fence when neutralized then only outside one is replaced", () => {
            const original = "outside #junie ping\n```\n#junie inside\n```\ntail";
            const result = neutralizeJunieTriggers(original);

            // outside trigger broken
            expect(result.startsWith("outside #junie ")).toBe(false);
            // inside-fence trigger preserved
            expect(result).toContain("```\n#junie inside\n```");
        });

        test("given multiple fences when neutralized then each fence content is preserved", () => {
            const original = "a #junie x\n```\n#junie one\n```\nmid\n```\n#junie two\n```\nend #junie";
            const result = neutralizeJunieTriggers(original);

            expect(result).toContain("```\n#junie one\n```");
            expect(result).toContain("```\n#junie two\n```");
            // and the outer triggers are neutralized
            expect(GITLAB_JUNIE_RULE.test(stripFences(result))).toBe(false);
        });
    });

    describe("idempotency & safety", () => {
        test("given already-neutralized text when neutralized again then result is unchanged", () => {
            const once = neutralizeJunieTriggers("#junie do it");
            const twice = neutralizeJunieTriggers(once);
            expect(twice).toBe(once);
        });

        test("given text without any trigger when neutralized then text is returned unchanged", () => {
            const original = "Just a regular comment with no triggers in it.";
            expect(neutralizeJunieTriggers(original)).toBe(original);
        });
    });
});

/** Helper: drop ```...``` blocks before running GitLab rule self-check. */
function stripFences(text: string): string {
    return text.replace(/```[\s\S]*?```/g, "");
}
