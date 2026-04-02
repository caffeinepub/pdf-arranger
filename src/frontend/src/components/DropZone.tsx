import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileText, Upload } from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";

interface DropZoneProps {
  onFilesAdded: (files: File[]) => void;
  compact?: boolean;
}

export default function DropZone({
  onFilesAdded,
  compact = false,
}: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === "application/pdf",
    );
    if (droppedFiles.length > 0) {
      onFilesAdded(droppedFiles);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []).filter(
      (f) => f.type === "application/pdf",
    );
    if (selected.length > 0) {
      onFilesAdded(selected);
    }
    e.target.value = "";
  }

  if (compact) {
    return (
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />
    );
  }

  return (
    <div
      data-ocid="dropzone.dropzone"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "rounded-2xl border-2 border-dashed transition-all duration-200",
        "min-h-[320px] flex items-center",
        isDragOver
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-primary/40",
      )}
    >
      <input
        ref={inputRef}
        id="dropzone-file-input"
        type="file"
        accept="application/pdf"
        multiple
        className="sr-only"
        onChange={handleFileInput}
      />

      <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-8 px-10 py-12">
        {/* Left: icon illustration */}
        <div className="flex items-center justify-center">
          <motion.div
            animate={isDragOver ? { scale: 1.12 } : { scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
            className={cn(
              "relative w-36 h-36 rounded-2xl flex items-center justify-center shadow-lg transition-colors duration-200",
              isDragOver ? "bg-primary/20" : "bg-muted",
            )}
          >
            <FileText
              className={cn(
                "w-14 h-14 transition-colors duration-200",
                isDragOver ? "text-primary" : "text-muted-foreground/60",
              )}
            />
            <motion.div
              animate={
                isDragOver ? { y: -6, opacity: 1 } : { y: 0, opacity: 0.5 }
              }
              transition={{ type: "spring", stiffness: 260, damping: 16 }}
              className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-primary/90 flex items-center justify-center shadow-md"
            >
              <Upload className="w-5 h-5 text-white" />
            </motion.div>
          </motion.div>
        </div>

        {/* Right: text + CTA */}
        <div className="flex flex-col justify-center gap-4 md:pl-2">
          <div>
            <h2 className="text-2xl font-bold text-foreground leading-tight">
              {isDragOver ? "Drop your PDFs!" : "Drag PDFs here to get started"}
            </h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Reorder, rotate, remove pages, then merge into a single PDF.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="lg"
              data-ocid="dropzone.upload_button"
              onClick={() => inputRef.current?.click()}
              className="w-fit"
            >
              <Upload className="w-4 h-4 mr-2" />
              Browse Files
            </Button>
            <p className="text-xs text-muted-foreground">
              PDF files only · Multiple files supported · 100% client-side
            </p>
          </div>

          {/* Keyboard shortcuts mini-hint */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-[10px]">
                R
              </kbd>{" "}
              Rotate right
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-[10px]">
                Del
              </kbd>{" "}
              Remove
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-[10px]">
                Ctrl+Z
              </kbd>{" "}
              Undo
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
