import { App, Plugin, TFile, Notice, Modal, Setting, PluginSettingTab } from 'obsidian';

interface UnusedBlockId {
    id: string;
    file: string;
    line: string;
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

        containerEl.createEl('h2', { text: 'Unused Block ID Remover Settings' });

        new Setting(containerEl)
            .setName('Excluded File Extensions')
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
        const { contentEl, modalEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Unused Block IDs' });

        // Make the modal draggable
        this.makeDraggable(modalEl);

        const list = contentEl.createEl('ul');
        this.unusedBlockIds.forEach(item => {
            const li = list.createEl('li');
            const link = li.createEl('a', {
                text: item.id,
                href: '#'
            });
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.plugin.openFileAtBlockId(item.file, item.id);
            });
            li.createEl('span', { text: ` in file: ${item.file}` });
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Delete All')
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

    makeDraggable(modalEl: HTMLElement) {
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        modalEl.style.position = 'absolute';

        modalEl.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - modalEl.getBoundingClientRect().left;
            offsetY = e.clientY - modalEl.getBoundingClientRect().top;
            modalEl.style.cursor = 'move';
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                modalEl.style.left = `${e.clientX - offsetX}px`;
                modalEl.style.top = `${e.clientY - offsetY}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            modalEl.style.cursor = 'default';
        });
    }
}

export default class UnusedBlockIdRemover extends Plugin {
    settings: UnusedBlockIdRemoverSettings;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new UnusedBlockIdRemoverSettingTab(this.app, this));

        this.addCommand({
            id: 'scan-vault',
            name: 'Scan Vault',
            callback: () => this.findUnusedBlockIds(),
        });
    }

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
            // If the excludedExtensions setting is empty, include all files
            const excludedExtensions = this.settings.excludedExtensions.filter(ext => ext); // Filter out empty strings
            const files = this.app.vault.getMarkdownFiles().filter(file => {
                // If there are no excluded extensions, return true (include all files)
                if (excludedExtensions.length === 0) {
                    return true;
                }
                // Otherwise, exclude files that end with any of the extensions
                return !excludedExtensions.some(ext => file.path.endsWith(ext));
            });

            const blockIds = new Map<string, UnusedBlockId>();
            const blockIdReferences = new Set<string>();

            for (const file of files) {
                const content = await this.app.vault.cachedRead(file);
                this.collectBlockIdsAndReferences(content, file.path, blockIds, blockIdReferences);
            }

            const unusedBlockIds = Array.from(blockIds.values())
                .filter(item => !blockIdReferences.has(item.id));

            loadingNotice.hide();

            // If no unused block IDs are found, show a notice
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
        blockIds: Map<string, UnusedBlockId>,
        blockIdReferences: Set<string>
    ) {
        const lines = content.split('\n');
        const blockIdRegex = /\^([\w-]+)$/;  // Matches block IDs like ^blockID
        const blockIdRefRegex = /\[\[(.*?)#\^([\w-]+)\s*(\|.*?)?\]\]/g;  // Updated to handle spaces around |

        lines.forEach((line, index) => {
            // Match block IDs at the end of the line, e.g., ^blockID
            const match = line.match(blockIdRegex);
            if (match && this.isValidBlockId(match[1])) {
                blockIds.set(match[1], {
                    id: match[1],
                    file: filePath,
                    line: line.trim()
                });
            }

            // Match block references, e.g., [[filename#^blockID | optional text]]
            let refMatch;
            while ((refMatch = blockIdRefRegex.exec(line)) !== null) {
                blockIdReferences.add(refMatch[2]);  // refMatch[2] captures the block ID
            }
        });
    }

    isValidBlockId(id: string): boolean {
        return /^[\w-]+$/.test(id);
    }

    async deleteUnusedBlockIds(unusedBlockIds: UnusedBlockId[]) {
        const loadingNotice = new Notice('Deleting unused block IDs...', 0);
        let totalRemoved = 0;
        const fileChanges = new Map<string, string[]>();

        try {
            for (const item of unusedBlockIds) {
                if (!fileChanges.has(item.file)) {
                    const file = this.app.vault.getAbstractFileByPath(item.file);
                    if (file instanceof TFile) {
                        const content = await this.app.vault.read(file);
                        fileChanges.set(item.file, content.split('\n'));
                    }
                }

                const lines = fileChanges.get(item.file);
                if (lines) {
                    const index = lines.findIndex(line => line.includes(`^${item.id}`));
                    if (index !== -1) {
                        lines[index] = lines[index].replace(/\s*\^[\w-]+$/, '');
                        totalRemoved++;
                    }
                }
            }

            for (const [filePath, lines] of fileChanges) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    await this.app.vault.modify(file, lines.join('\n'));
                }
            }

            loadingNotice.hide();
            new Notice(`Removed ${totalRemoved} unused block IDs.`);
        } catch (error) {
            loadingNotice.hide();
            new Notice(`Error: ${error.message}`);
        }
    }

    async openFileAtBlockId(filePath: string, blockId: string) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(file, {
                eState: { line: await this.getLineNumberForBlockId(file, blockId) }
            });
        }
    }

    async getLineNumberForBlockId(file: TFile, blockId: string): Promise<number> {
        const content = await this.app.vault.cachedRead(file);
        const lines = content.split('\n');
        const index = lines.findIndex(line => line.includes(`^${blockId}`));
        return index !== -1 ? index : 0;
    }
}
