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
import { useState } from "react";

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
  const positionOptions: { label: string; value: number }[] = [];
  if (targetFile) {
    const activePages = targetFile.pageOrder.filter(
      (p) => !targetFile.removePages.includes(p),
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
    setTargetFileId("");
    setTargetPosition("");
  }

  function handleClose() {
    setTargetFileId("");
    setTargetPosition("");
    onClose();
  }

  // Reset position when file changes
  function handleFileChange(val: string) {
    setTargetFileId(val);
    setTargetPosition("");
  }

  const canMove = targetFileId !== "" && targetPosition !== "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
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
              <SelectContent>
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
              <SelectContent>
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
