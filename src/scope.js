import {parseFrontMatterTags} from "obsidian";
import {Tag} from "./Tag";

export const DEFAULT_SETTINGS = {
    scopedTags: {
        enabled: false,
        tagRules: [],
        fileRules: []
    }
};

export function normalizeSettings(data = {}) {
    data = data || {};
    const scopedTags = data.scopedTags || {};
    return {
        ...DEFAULT_SETTINGS,
        ...data,
        scopedTags: {
            enabled: !!scopedTags.enabled,
            tagRules: normalizeRules(scopedTags.tagRules),
            fileRules: normalizeRules(scopedTags.fileRules, normalizeFileRule)
        }
    };
}

function normalizeRules(rules, normalize = normalizeRule) {
    return Array.isArray(rules) ? rules.map(normalize).filter(Boolean) : [];
}

function normalizeRule(rule) {
    if (!rule) return;
    return {
        enabled: rule.enabled !== false,
        pattern: String(rule.pattern || "").trim(),
        note: String(rule.note || "")
    };
}

function normalizeFileRule(rule) {
    const normalized = normalizeRule(rule);
    if (!normalized) return;
    normalized.mode = rule.mode === "exclude" ? "exclude" : "include";
    return normalized;
}

export function buildScopedTags(app, settings, tagPages) {
    const scopedTags = settings?.scopedTags;
    if (!shouldBuildScopedTags(settings)) return;

    return collectTags(app, tagPages, {
        tagRules: scopedTags.tagRules,
        fileRules: scopedTags.fileRules
    });
}

export async function buildScopedTagsAsync(app, settings, tagPages, isCurrent = () => true) {
    const scopedTags = settings?.scopedTags;
    if (!shouldBuildScopedTags(settings)) return;

    const result = Object.create(null);
    const displayNames = new Map();
    const tagRules = enabledRules(scopedTags.tagRules);
    const fileMatcher = compileFileScopeMatcher(scopedTags.fileRules);
    const files = app.metadataCache.getCachedFiles();

    await yieldToUI();

    function addTag(tag, count = 1) {
        if (!tag || typeof tag !== "string") return;
        tag = Tag.toTag(tag);
        if (!Tag.isTag(tag)) return;
        if (tagRules.length && !tagRules.some(rule => tagMatchesPattern(tag, rule.pattern))) return;

        const canonical = Tag.canonical(tag);
        let displayName = displayNames.get(canonical);
        if (!displayName) {
            displayName = tag;
            displayNames.set(canonical, displayName);
            result[displayName] = 0;
        }
        result[displayName] += count;
    }

    for (let index = 0; index < files.length; index++) {
        if (!isCurrent()) return;

        const filename = files[index];
        if (!fileMatcher(filename)) continue;

        const cache = app.metadataCache.getCache(filename);
        for (const item of cache?.tags || []) addTag(item.tag);
        for (const tag of parseFrontMatterTags(cache?.frontmatter) || []) addTag(tag);

        if (index && index % 1000 === 0) await yieldToUI();
    }

    for (const [canonical, pages] of tagPages || []) {
        if (!fileIncludedTagPage(pages, scopedTags.fileRules)) continue;
        const tag = pages.tag || canonical;
        if (tagRules.length && !tagRules.some(rule => tagMatchesPattern(tag, rule.pattern))) continue;
        if (!displayNames.has(canonical)) result[tag] = 0;
    }

    return result;
}

export function shouldBuildScopedTags(settings) {
    const scopedTags = settings?.scopedTags;
    return !!(
        scopedTags?.enabled &&
        (enabledRules(scopedTags.tagRules).length || enabledRules(scopedTags.fileRules).length)
    );
}

export function getScopeStats(app, settings, tagPages) {
    const allTags = collectTags(app, tagPages);
    const scopedTags = settings.scopedTags.enabled
        ? collectTags(app, tagPages, settings.scopedTags)
        : allTags;
    const files = app.metadataCache.getCachedFiles();

    return {
        totalTags: Object.keys(allTags).length,
        visibleTags: Object.keys(scopedTags).length,
        hiddenTags: Math.max(0, Object.keys(allTags).length - Object.keys(scopedTags).length),
        totalFiles: files.length,
        includedFiles: settings.scopedTags.enabled
            ? files.filter(path => fileIncluded(path, settings.scopedTags.fileRules)).length
            : files.length
    };
}

export async function buildScopeReport(app, settings, tagPages, isCurrent = () => true) {
    const files = app.metadataCache.getCachedFiles();
    const allTags = Object.create(null);
    const scopedTags = Object.create(null);
    const allDisplayNames = new Map();
    const scopedDisplayNames = new Map();
    const scopedTagRules = enabledRules(settings.scopedTags.tagRules);
    const scopedFileRules = settings.scopedTags.fileRules || [];
    const scopedFileMatcher = compileFileScopeMatcher(scopedFileRules);
    const fileRuleMatchers = settings.scopedTags.fileRules.map(rule => (
        rule.pattern ? compilePathMatcher(rule.pattern) : undefined
    ));
    const fileRuleMatches = settings.scopedTags.fileRules.map(() => 0);
    let includedFiles = 0;

    await yieldToUI();

    function addTag(result, displayNames, tag, tagRules = []) {
        if (!tag || typeof tag !== "string") return;
        tag = Tag.toTag(tag);
        if (!Tag.isTag(tag)) return;
        if (tagRules.length && !tagRules.some(rule => tagMatchesPattern(tag, rule.pattern))) return;

        const canonical = Tag.canonical(tag);
        let displayName = displayNames.get(canonical);
        if (!displayName) {
            displayName = tag;
            displayNames.set(canonical, displayName);
            result[displayName] = 0;
        }
        result[displayName]++;
    }

    for (let index = 0; index < files.length; index++) {
        if (!isCurrent()) return;

        const filename = files[index];
        const normalizedFilename = normalizePath(filename);
        fileRuleMatchers.forEach((matches, ruleIndex) => {
            if (matches?.(normalizedFilename)) fileRuleMatches[ruleIndex]++;
        });

        const cache = app.metadataCache.getCache(filename);
        const bodyTags = cache?.tags || [];
        const frontmatterTags = parseFrontMatterTags(cache?.frontmatter) || [];
        const included = scopedFileMatcher(normalizedFilename);

        if (included) includedFiles++;

        for (const item of bodyTags) {
            addTag(allTags, allDisplayNames, item.tag);
            if (included) addTag(scopedTags, scopedDisplayNames, item.tag, scopedTagRules);
        }
        for (const tag of frontmatterTags) {
            addTag(allTags, allDisplayNames, tag);
            if (included) addTag(scopedTags, scopedDisplayNames, tag, scopedTagRules);
        }

        if (index && index % 1000 === 0) await yieldToUI();
    }

    for (const [canonical, pages] of tagPages || []) {
        addTag(allTags, allDisplayNames, pages.tag || canonical, []);
        if (fileIncludedTagPage(pages, scopedFileRules)) {
            addTag(scopedTags, scopedDisplayNames, pages.tag || canonical, scopedTagRules);
        }
    }

    const scopeHasRules = scopedTagRules.length || enabledRules(scopedFileRules).length;
    const visibleTags = settings.scopedTags.enabled && scopeHasRules ? scopedTags : allTags;
    const allTagNames = Object.keys(allTags);

    return {
        stats: {
            totalTags: allTagNames.length,
            visibleTags: Object.keys(visibleTags).length,
            hiddenTags: Math.max(0, allTagNames.length - Object.keys(visibleTags).length),
            totalFiles: files.length,
            includedFiles: settings.scopedTags.enabled ? includedFiles : files.length
        },
        tagRuleMatches: settings.scopedTags.tagRules.map(rule => (
            rule.pattern ? allTagNames.filter(tag => tagMatchesPattern(tag, rule.pattern)).length : 0
        )),
        fileRuleMatches
    };
}

export function countTagRuleMatches(app, tagPages, rule) {
    if (!rule?.pattern) return 0;
    return Object.keys(collectTags(app, tagPages))
        .filter(tag => tagMatchesPattern(tag, rule.pattern))
        .length;
}

export function countFileRuleMatches(app, rule) {
    if (!rule?.pattern) return 0;
    return app.metadataCache.getCachedFiles()
        .filter(path => pathMatchesPattern(path, rule.pattern))
        .length;
}

function collectTags(app, tagPages, scope = {}) {
    const result = Object.create(null);
    const displayNames = new Map();
    const tagRules = enabledRules(scope.tagRules);
    const fileRules = scope.fileRules || [];

    function addTag(tag, count = 1) {
        if (!tag || typeof tag !== "string") return;
        tag = Tag.toTag(tag);
        if (!Tag.isTag(tag)) return;
        if (tagRules.length && !tagRules.some(rule => tagMatchesPattern(tag, rule.pattern))) return;

        const canonical = Tag.canonical(tag);
        let displayName = displayNames.get(canonical);
        if (!displayName) {
            displayName = tag;
            displayNames.set(canonical, displayName);
            result[displayName] = 0;
        }
        result[displayName] += count;
    }

    for (const filename of app.metadataCache.getCachedFiles()) {
        if (!fileIncluded(filename, fileRules)) continue;

        const cache = app.metadataCache.getCache(filename);
        for (const item of cache?.tags || []) addTag(item.tag);
        for (const tag of parseFrontMatterTags(cache?.frontmatter) || []) addTag(tag);
    }

    for (const [canonical, files] of tagPages || []) {
        if (fileRules.length && !Array.from(files).some(file => fileIncluded(file?.path, fileRules))) continue;
        const tag = files.tag || canonical;
        if (tagRules.length && !tagRules.some(rule => tagMatchesPattern(tag, rule.pattern))) continue;
        if (!displayNames.has(canonical)) result[tag] = 0;
    }

    return result;
}

function fileIncludedTagPage(files, fileRules) {
    if (!fileRules?.length) return true;
    const matches = compileFileScopeMatcher(fileRules);
    return Array.from(files).some(file => matches(normalizePath(file?.path)));
}

function yieldToUI() {
    return new Promise(resolve => activeWindow.setTimeout(resolve, 0));
}

function enabledRules(rules) {
    return (rules || []).filter(rule => rule.enabled !== false && rule.pattern);
}

function fileIncluded(path, rules = []) {
    path = normalizePath(path);
    return compileFileScopeMatcher(rules)(path);
}

function compileFileScopeMatcher(rules = []) {
    const enabledFileRules = enabledRules(rules);
    const includeRules = enabledFileRules
        .filter(rule => rule.mode !== "exclude")
        .map(rule => compilePathMatcher(rule.pattern));
    const excludeRules = enabledFileRules
        .filter(rule => rule.mode === "exclude")
        .map(rule => compilePathMatcher(rule.pattern));

    return path => {
        path = normalizePath(path);
        const included = includeRules.length
            ? includeRules.some(matches => matches(path))
            : true;

        return included && !excludeRules.some(matches => matches(path));
    };
}

export function tagMatchesPattern(tag, pattern) {
    tag = Tag.toTag(String(tag || "").trim()).toLowerCase();
    pattern = Tag.toTag(String(pattern || "").trim()).toLowerCase();
    if (!pattern || pattern === "#") return false;

    if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -1);
        return tag.startsWith(prefix);
    }

    if (hasWildcard(pattern)) return globToRegExp(pattern, false).test(tag);
    return tag === pattern;
}

export function pathMatchesPattern(path, pattern) {
    path = normalizePath(path);
    return compilePathMatcher(pattern)(path);
}

function compilePathMatcher(pattern) {
    pattern = normalizePath(pattern);
    if (!pattern) return () => false;

    if (hasWildcard(pattern)) {
        const wildcardPattern = pattern.endsWith("/") ? pattern + "**" : pattern;
        const regex = globToRegExp(wildcardPattern, true);
        return path => regex.test(path);
    }
    if (pattern.endsWith("/")) return path => path.startsWith(pattern);
    return path => path === pattern || path.startsWith(pattern + "/");
}

function normalizePath(path) {
    return String(path || "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .trim();
}

function hasWildcard(pattern) {
    return /[*?]/.test(pattern);
}

function globToRegExp(pattern, pathMode) {
    let re = "^";
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === "*") {
            if (pattern[i + 1] === "*") {
                re += ".*";
                i++;
            } else {
                re += pathMode ? "[^/]*" : ".*";
            }
        } else if (ch === "?") {
            re += pathMode ? "[^/]" : ".";
        } else {
            re += escapeRegExp(ch);
        }
    }
    return new RegExp(re + "$");
}

function escapeRegExp(text) {
    return text.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}
