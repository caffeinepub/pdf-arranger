import type { FileData, SelectedPage } from "@/App";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useState } from "react";

interface MoveDialogProps {
  open: boolean;
  filesData: FileData[];
  selectedPages: SelectedPage[];
  onClose: () => void;
  onMove: (targetFileId: number, targetPosition: number) => void;
}

export default function MoveDialog({
  open,
  filesData,
  selectedPages,
  onClose,
  onMove,
}: MoveDialogProps) {
  const [targetFileId, setTargetFileId] = useState<string>("");
  const [targetPosition, setTargetPosition] = useState<string>("");

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTargetFileId("");
      setTargetPosition("");
    }
  }, [open]);

  // Derive selected page summary
  const selectionSummary = (() => {
    const byFile = new Map<number, number[]>();
    for (const p of selectedPages) {
      if (!byFile.has(p.id)) byFile.set(p.id, []);
      byFile.get(p.id)!.push(p.pageNum);
    }
    const parts: string[] = [];
    for (const [fileId, pages] of byFile) {
      const file = filesData.find((f) => f.id === fileId);
      const name = file ? file.file.name : "Unknown";
      parts.push(
        `${pages.length} page${pages.length > 1 ? "s" : ""} from "${name}"`,
      );
    }
    return parts.join(", ");
  })();

  const targetFile = targetFileId
    ? filesData.find((f) => f.id === Number(targetFileId))
    : null;

  // Positions: before page 1, between pages, after last page
  // For same-file moves, exclude the pages being moved from the count since
  // they will be removed before the insertion point is resolved.
  const positionOptions: { label: string; value: number }[] = [];
  if (targetFile) {
    // Build the set of page numbers being moved that belong to the target file
    const movingPageNums = new Set(
      selectedPages
        .filter((p) => p.id === Number(targetFileId))
        .map((p) => p.pageNum),
    );

    const activePages = targetFile.pageOrder.filter(
      (p) => !targetFile.removePages.includes(p) && !movingPageNums.has(p),
    );
    positionOptions.push({ label: "Beginning (before page 1)", value: 0 });
    for (let i = 0; i < activePages.length; i++) {
      positionOptions.push({
        label: `After page ${i + 1}`,
        value: i + 1,
      });
    }
  }

  function handleMove() {
    if (!targetFileId || targetPosition === "") return;
    onMove(Number(targetFileId), Number(targetPosition));
  }

  function handleClose() {
    onClose();
  }

  // Reset position when file changes
  function handleFileChange(val: string) {
    setTargetFileId(val);
    setTargetPosition("");
  }

  const canMove = targetFileId !== "" && targetPosition !== "";

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Only handle explicit close (not triggered by inner popovers/selects)
        if (!isOpen) {
          handleClose();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => {
          // Prevent closing when interacting with Select dropdowns (they use portals)
          // Check if the click target is inside a Radix select content
          const target = e.target as HTMLElement;
          if (
            target.closest("[data-radix-select-viewport]") ||
            target.closest("[data-radix-popper-content-wrapper]") ||
            target.closest("[role='listbox']") ||
            target.closest("[role='option']") ||
            target.closest("[data-radix-collection-item]")
          ) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Move Pages</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Selection summary */}
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Moving:{" "}
            <span className="text-foreground font-medium">
              {selectionSummary}
            </span>
          </div>

          {/* Target file */}
          <div className="space-y-1.5">
            <Label htmlFor="target-file">Destination PDF</Label>
            <Select value={targetFileId} onValueChange={handleFileChange}>
              <SelectTrigger id="target-file">
                <SelectValue placeholder="Select a PDF file..." />
              </SelectTrigger>
              <SelectContent
                // Render inside the dialog to avoid portal focus conflicts
                position="popper"
              >
                {filesData.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.file.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Target position */}
          <div className="space-y-1.5">
            <Label htmlFor="target-position">Insert At</Label>
            <Select
              value={targetPosition}
              onValueChange={setTargetPosition}
              disabled={!targetFile}
            >
              <SelectTrigger id="target-position">
                <SelectValue
                  placeholder={
                    targetFile ? "Select position..." : "Select a file first"
                  }
                />
              </SelectTrigger>
              <SelectContent position="popper">
                {positionOptions.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={!canMove}>
            Move Pages
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
