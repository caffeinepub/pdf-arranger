# PDF Arranger

## Current State
Cross-file page drag-and-drop exists but is broken:
- Moving a page to another file corrupts the rotation array (splices at wrong index)
- Thumbnails are not carried over to the target file
- You can only drop onto an existing page thumbnail — there's no way to drop at the end of a file or onto an empty file
- No visual drop-zone indicator when dragging over a different file card

## Requested Changes (Diff)

### Add
- Visual drop-target indicator inside each file card when a page is being dragged over it ("Drop here" slot at the end of the thumbnail grid)
- Ability to drop a page at the end of a target file's page list
- Carry the source page's thumbnail when moving cross-file

### Modify
- Fix `handlePageDrop` in App.tsx: when moving cross-file, correctly transfer rotation and thumbnail alongside the page number
- Fix the rotation splice: rotations are keyed by pageNum-1 (original index), not by position in pageOrder
- Update FileCard and PageThumb to pass a `isDraggingPage` flag so FileCard can show a drop-zone slot at the end

### Remove
- Nothing removed

## Implementation Plan
1. Add `isDraggingPage` boolean state in App.tsx, set true on page drag start, false on drag end
2. Pass `isDraggingPage` down to FileCard
3. In FileCard, when `isDraggingPage` is true, render a drop-zone slot after the last thumbnail that calls `onPageDrop` with a sentinel (null/undefined targetPageNum) meaning "append to end"
4. In App.tsx `handlePageDrop`, handle the sentinel "append" case
5. Fix cross-file rotation transfer: copy `srcFile.rotations[srcPageNum - 1]` into `tgtFile.rotations` at the correct new slot, and remove it correctly from srcFile
6. Fix cross-file thumbnail transfer: copy thumbnail from srcFile to tgtFile at correct slot
7. Ensure the page number remains valid after cross-file move (pages retain their original page number identity for the merge)
