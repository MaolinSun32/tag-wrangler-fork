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
    if (!scopedTags?.enabled) return;
    if (!enabledRules(scopedTags.tagRules).length && !enabledRules(scopedTags.fileRules).length) return;

    return collectTags(app, tagPages, {
        tagRules: scopedTags.tagRules,
        fileRules: scopedTags.fileRules
    });
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

function enabledRules(rules) {
    return (rules || []).filter(rule => rule.enabled !== false && rule.pattern);
}

function fileIncluded(path, rules = []) {
    path = normalizePath(path);
    const enabledFileRules = enabledRules(rules);
    const includeRules = enabledFileRules.filter(rule => rule.mode !== "exclude");
    const excludeRules = enabledFileRules.filter(rule => rule.mode === "exclude");

    const included = includeRules.length
        ? includeRules.some(rule => pathMatchesPattern(path, rule.pattern))
        : true;

    return included && !excludeRules.some(rule => pathMatchesPattern(path, rule.pattern));
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
    pattern = normalizePath(pattern);
    if (!pattern) return false;

    if (hasWildcard(pattern)) return globToRegExp(pattern, true).test(path);
    if (pattern.endsWith("/")) return path.startsWith(pattern);
    return path === pattern || path.startsWith(pattern + "/");
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
