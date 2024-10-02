# Remove Unused Block IDs
A simple plugin that removes unused block IDs.

## Caution
Back up your files before using this plugin to prevent any data loss which may occur when the plugin works unexpectedly.

## Limitations
- If a block id is referenced in a canvas card and not anywhere else, it will be added to the unused block IDs list because a canvas card is not a markdown file.
- If a page has duplicate block IDs and it is referenced (see picture), the plugin will fail to distinguish which block is used (Obsidian also does not handle duplicate block IDs well so avoid using duplicate block IDs within a single page). However, if the duplicate block IDs are not being referenced, the plugin will work as expected and delete the duplicate block IDs.
![Duplicate ids](https://imgur.com/YVLT6zO)

## How to use?
Open the command palette and run the command **Remove Unused Block IDs: Scan vault**.