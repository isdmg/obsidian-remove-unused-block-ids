# Remove Unused Block IDs
A simple plugin that removes unused block IDs.

## Caution
Consider backing up your vault before using this plugin to avoid any risk of data loss.

## Limitations
- When a block ID is only referenced in a canvas card (and nowhere else), it will be considered unused and added to the unused block IDs list. This happens because a canvas card is not treated like a markdown file.
- If a page has duplicate block IDs and one of those IDs is referenced (as shown in the picture), the plugin won’t be able to tell which block is in use. Obsidian also struggles with handling duplicate block IDs within a single page, so avoid using them. If the duplicate IDs aren’t referenced, the plugin will work correctly and remove all of the instances of the duplicates.
![Duplicate block ids](https://i.imgur.com/YVLT6zO.png)

## How to use?
1. Open the command palette and run the command **Remove Unused Block IDs: Scan vault**.
2. Confirm the deletion of unused block IDs.