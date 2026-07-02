import {PluginSettingTab, Setting} from "obsidian";
import {countFileRuleMatches, countTagRuleMatches, getScopeStats} from "./scope";

export class TagWranglerSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const {containerEl} = this;
        containerEl.empty();
        containerEl.addClass("tag-wrangler-settings");

        containerEl.createEl("h2", {text: "Tag Wrangler"});

        const stats = getScopeStats(this.app, this.plugin.settings, this.plugin.tagPages);
        new Setting(containerEl)
            .setName("Scoped tag list")
            .setDesc(
                "Filter the Tags view to tags and files that match the rules below. Files remain searchable and linkable in Obsidian."
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.scopedTags.enabled)
                .onChange(value => this.update(async () => {
                    this.plugin.settings.scopedTags.enabled = value;
                }))
            );

        containerEl.createDiv({
            cls: "tag-wrangler-scope-summary",
            text: `Visible tags: ${stats.visibleTags} / ${stats.totalTags}. Included files: ${stats.includedFiles} / ${stats.totalFiles}.`
        });

        this.renderTagRules(containerEl);
        this.renderFileRules(containerEl);
    }

    renderTagRules(containerEl) {
        const section = this.createSection(containerEl, "Tag allow list", "Only matching tags are shown when scoped tags are enabled.");
        new Setting(section.headerEl)
            .addButton(button => button
                .setButtonText("New")
                .onClick(() => this.update(async () => {
                    this.plugin.settings.scopedTags.tagRules.push({enabled: true, pattern: "", note: ""});
                }))
            );

        const grid = section.bodyEl.createDiv({cls: "tag-wrangler-rule-grid tag-wrangler-tag-rules"});
        this.addHeader(grid, ["Enabled", "Pattern", "Matches", "Note", ""]);

        const rules = this.plugin.settings.scopedTags.tagRules;
        if (!rules.length) {
            this.addEmptyState(grid, "No tag rules. Add a rule such as #area/* or #review.");
            return;
        }

        rules.forEach((rule, index) => {
            this.addToggleCell(grid, rule.enabled, value => this.update(async () => {
                rule.enabled = value;
            }));
            this.addTextCell(grid, rule.pattern, "#area/*", value => this.update(async () => {
                rule.pattern = value;
            }));
            grid.createDiv({
                cls: "tag-wrangler-rule-count",
                text: String(countTagRuleMatches(this.app, this.plugin.tagPages, rule))
            });
            this.addTextCell(grid, rule.note, "Optional note", value => this.update(async () => {
                rule.note = value;
            }));
            this.addDeleteButton(grid, () => this.update(async () => {
                rules.splice(index, 1);
            }));
        });
    }

    renderFileRules(containerEl) {
        const section = this.createSection(containerEl, "File scope", "Include or exclude folders and files from tag counting only.");
        new Setting(section.headerEl)
            .addButton(button => button
                .setButtonText("New include")
                .onClick(() => this.update(async () => {
                    this.plugin.settings.scopedTags.fileRules.push({enabled: true, mode: "include", pattern: "", note: ""});
                }))
            )
            .addButton(button => button
                .setButtonText("New exclude")
                .onClick(() => this.update(async () => {
                    this.plugin.settings.scopedTags.fileRules.push({enabled: true, mode: "exclude", pattern: "", note: ""});
                }))
            );

        const grid = section.bodyEl.createDiv({cls: "tag-wrangler-rule-grid tag-wrangler-file-rules"});
        this.addHeader(grid, ["Enabled", "Mode", "Path pattern", "Files", "Note", ""]);

        const rules = this.plugin.settings.scopedTags.fileRules;
        if (!rules.length) {
            this.addEmptyState(grid, "No file rules. Without include rules, all files are included unless excluded.");
            return;
        }

        rules.forEach((rule, index) => {
            this.addToggleCell(grid, rule.enabled, value => this.update(async () => {
                rule.enabled = value;
            }));
            this.addModeCell(grid, rule.mode, value => this.update(async () => {
                rule.mode = value;
            }));
            this.addTextCell(grid, rule.pattern, "20-Projects/RedNotes/", value => this.update(async () => {
                rule.pattern = value;
            }));
            grid.createDiv({
                cls: "tag-wrangler-rule-count",
                text: String(countFileRuleMatches(this.app, rule))
            });
            this.addTextCell(grid, rule.note, "Optional note", value => this.update(async () => {
                rule.note = value;
            }));
            this.addDeleteButton(grid, () => this.update(async () => {
                rules.splice(index, 1);
            }));
        });
    }

    createSection(containerEl, title, description) {
        const sectionEl = containerEl.createDiv({cls: "tag-wrangler-rule-section"});
        const headerEl = sectionEl.createDiv({cls: "tag-wrangler-rule-section-header"});
        const titleEl = headerEl.createDiv();
        titleEl.createEl("h3", {text: title});
        titleEl.createDiv({cls: "setting-item-description", text: description});
        const bodyEl = sectionEl.createDiv({cls: "tag-wrangler-rule-box"});
        return {sectionEl, headerEl, bodyEl};
    }

    addHeader(grid, labels) {
        for (const label of labels) grid.createDiv({cls: "tag-wrangler-rule-header", text: label});
    }

    addEmptyState(grid, text) {
        grid.createDiv({cls: "tag-wrangler-rule-empty", text});
    }

    addToggleCell(grid, value, onChange) {
        const cell = grid.createDiv({cls: "tag-wrangler-rule-cell"});
        const input = cell.createEl("input", {attr: {type: "checkbox"}});
        input.checked = value !== false;
        input.addEventListener("change", () => onChange(input.checked));
    }

    addModeCell(grid, value, onChange) {
        const cell = grid.createDiv({cls: "tag-wrangler-rule-cell"});
        const select = cell.createEl("select");
        select.createEl("option", {text: "include", attr: {value: "include"}});
        select.createEl("option", {text: "exclude", attr: {value: "exclude"}});
        select.value = value === "exclude" ? "exclude" : "include";
        select.addEventListener("change", () => onChange(select.value));
    }

    addTextCell(grid, value, placeholder, onChange) {
        const cell = grid.createDiv({cls: "tag-wrangler-rule-cell"});
        const input = cell.createEl("input", {attr: {type: "text", placeholder}});
        input.value = value || "";
        const save = () => {
            if (input.value !== value) onChange(input.value.trim());
        };
        input.addEventListener("blur", save);
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                save();
                input.blur();
            }
        });
    }

    addDeleteButton(grid, onClick) {
        const cell = grid.createDiv({cls: "tag-wrangler-rule-cell"});
        cell.createEl("button", {text: "Delete"}, button => {
            button.addEventListener("click", onClick);
        });
    }

    async update(mutator) {
        await mutator();
        await this.plugin.saveSettings();
        this.plugin.refreshTagsView();
        this.display();
    }
}
