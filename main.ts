import { App, Plugin, TFile, Notice, Modal, Setting, PluginSettingTab } from 'obsidian';

interface UnusedBlockId {
    id: string;
    file: string;
    line: string;
    lineNumber: number;
}

interface UnusedBlockIdRemoverSettings {
    excludedExtensions: string[];
}

const DEFAULT_SETTINGS: Partial<UnusedBlockIdRemoverSettings> = {
    excludedExtensions: ['.excalidraw.md']
}

class UnusedBlockIdRemoverSettingTab extends PluginSettingTab {
    plugin: UnusedBlockIdRemover;

    constructor(app: App, plugin: UnusedBlockIdRemover) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Excluded file extensions')
            .setDesc('Add file extensions (e.g., .excalidraw.md) separated by commas to exclude from scanning.')
            .addTextArea((text) => {
                text
                    .setPlaceholder('Enter extensions separated by commas')
                    .setValue(this.plugin.settings.excludedExtensions.join(', '))
                    .onChange(async (value) => {
                        this.plugin.settings.excludedExtensions = value.split(',').map(ext => ext.trim());
                        await this.plugin.saveSettings();
                    });
            });
    }
}

class ConfirmationModal extends Modal {
    plugin: UnusedBlockIdRemover;
    unusedBlockIds: UnusedBlockId[];

    constructor(plugin: UnusedBlockIdRemover, unusedBlockIds: UnusedBlockId[]) {
        super(plugin.app);
        this.plugin = plugin;
        this.unusedBlockIds = unusedBlockIds;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Unused Block IDs: (${this.unusedBlockIds.length})` });

        const list = contentEl.createEl('ul');
        this.unusedBlockIds.forEach(item => {
            const li = list.createEl('li');
            const link = li.createEl('a', {
                text: item.id,
                href: '#'
            });
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.plugin.openFileAtBlockId(item.file, item.id, item.lineNumber);
            });
            li.createEl('span', { text: ` in file: ${item.file}` });
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Delete all')
                .onClick(() => {
                    this.plugin.deleteUnusedBlockIds(this.unusedBlockIds);
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export default class UnusedBlockIdRemover extends Plugin {
    settings: UnusedBlockIdRemoverSettings;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new UnusedBlockIdRemoverSettingTab(this.app, this));

        this.addCommand({
            id: 'scan-vault',
            name: 'Scan vault',
            callback: () => this.findUnusedBlockIds(),
        });
    }

    onunload() { }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async findUnusedBlockIds() {
        const loadingNotice = new Notice('Searching for unused block IDs...', 0);

        try {
            const excludedExtensions = this.settings.excludedExtensions.filter(ext => ext);
            const files = this.app.vault.getMarkdownFiles().filter(file => {
                return excludedExtensions.length === 0 || !excludedExtensions.some(ext => file.path.endsWith(ext));
            });

            // Map to store block IDs, now keyed by both file path and block ID
            const blockIds = new Map<string, UnusedBlockId[]>();
            // Set to store block ID references, now using file path + block ID as key
            const blockIdReferences = new Set<string>();

            // Collect block IDs and references
            for (const file of files) {
                const content = await this.app.vault.cachedRead(file);
                this.collectBlockIdsAndReferences(content, file.path, blockIds, blockIdReferences);
            }

            // Identify unused block IDs by comparing blockIds and blockIdReferences
            const unusedBlockIds = Array.from(blockIds.entries())
                .flatMap(([key, blockIdArray]) => {
                    return blockIdArray.filter(item => {
                        const referenceKey = `${item.file}#${item.id}`;
                        return !blockIdReferences.has(referenceKey);
                    });
                });

            loadingNotice.hide();

            // If no unused block IDs found, show notice
            if (unusedBlockIds.length === 0) {
                new Notice('No unused block IDs found.');
            } else {
                // If unused block IDs are found, show the confirmation modal
                new ConfirmationModal(this, unusedBlockIds).open();
            }
        } catch (error) {
            loadingNotice.hide();
            new Notice(`Error: ${error.message}`);
        }
    }

    collectBlockIdsAndReferences(
        content: string,
        filePath: string,
        blockIds: Map<string, UnusedBlockId[]>,
        blockIdReferences: Set<string>
    ) {
        const lines = content.split('\n');
        const blockIdRegex = /(?:\s|^)\^([\w-]+)$/;  // Matches block IDs like ^blockID
        const blockIdRefRegex = /\[\[(.*?)#\^([\w-]+)\s*(\|.*?)?\]\]/g;  // Updated to handle spaces around |

        lines.forEach((line, index) => {
            // Match block IDs at the end of the line, e.g., ^blockID
            const match = line.match(blockIdRegex);
            if (match && this.isValidBlockId(match[1])) {
                const blockId = match[1];
                const blockIdKey = `${filePath}#${blockId}`;  // Create a unique key for block ID + file

                // Check if the blockId already exists in the map, and if so, append to the array
                if (!blockIds.has(blockIdKey)) {
                    blockIds.set(blockIdKey, []);  // Initialize an empty array for the blockId if not already present
                }

                // Push the new occurrence of this block ID to the array
                blockIds.get(blockIdKey)?.push({
                    id: blockId,
                    file: filePath,
                    line: line.trim(),
                    lineNumber: index
                });
            }

            // Match block references, e.g., [[filename#^blockID | optional text]]
            let refMatch;
            while ((refMatch = blockIdRefRegex.exec(line)) !== null) {
                const refFilePath = this.app.metadataCache.getFirstLinkpathDest(refMatch[1], filePath)?.path;  // Resolve the full path for the referenced file
                if (refFilePath) {
                    const blockRefKey = `${refFilePath}#${refMatch[2]}`;  // Create a unique key for the reference
                    blockIdReferences.add(blockRefKey);  // Add reference with full file path and block ID
                }
            }
        });
    }

    isValidBlockId(id: string): boolean {
        return /^[\w-]+$/.test(id);
    }

    async deleteUnusedBlockIds(unusedBlockIds: UnusedBlockId[]) {
        const loadingNotice = new Notice('Deleting unused block IDs...', 0);
        let totalRemoved = 0;

        // Group block IDs by file for efficient processing
        const blockIdsByFile = unusedBlockIds.reduce((acc, item) => {
            if (!acc[item.file]) {
                acc[item.file] = [];
            }
            acc[item.file].push(item);
            return acc;
        }, {} as Record<string, UnusedBlockId[]>);

        try {
            // Process each file one at a time
            for (const [filePath, blockIds] of Object.entries(blockIdsByFile)) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    // Use async processing with a single read and write per file
                    await this.app.vault.process(file, (content) => {
                        const lines = content.split('\n');
                        let fileChanged = false;

                        // Iterate over block IDs for this file
                        blockIds.forEach(blockId => {
                            const lineIndex = blockId.lineNumber;
                            if (lineIndex >= 0 && lineIndex < lines.length) {
                                const blockIdRegex = new RegExp(`\\s*\\^${blockId.id}$`);  // Target only block ID at end of line
                                if (blockIdRegex.test(lines[lineIndex])) {
                                    lines[lineIndex] = lines[lineIndex].replace(blockIdRegex, '');  // Remove the block ID
                                    totalRemoved++;
                                    fileChanged = true;
                                }
                            }
                        });

                        return fileChanged ? lines.join('\n') : content;  // Only save if the file was changed
                    });
                }
            }

            loadingNotice.hide();
            new Notice(`Removed ${totalRemoved} unused block IDs.`);
        } catch (error) {
            loadingNotice.hide();
            new Notice(`Error: ${error.message}`);
        }
    }

    async openFileAtBlockId(filePath: string, blockId: string, lineNumber: number) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(file, {
                eState: { line: lineNumber }
            });
        }
    }
}
