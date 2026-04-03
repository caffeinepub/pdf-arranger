import type { FileData, SelectedPage } from "@/App";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useRef, useState } from "react";
import PageThumb from "./PageThumb";

type ThumbSize = "sm" | "md" | "lg";

interface FileCardProps {
  data: FileData;
  index: number;
  selectedPages: SelectedPage[];
  thumbSize?: ThumbSize;
  onRemoveFile: (index: number) => void;
  onSelectPage: (page: SelectedPage, e?: React.MouseEvent) => void;
  onSelectAll: (fileId: number) => void;
  onPageDragStart: (
    e: React.DragEvent<HTMLDivElement>,
    fileId: number,
    pageNum: number,
  ) => void;
  onPageDragEnd: () => void;
  onPageDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onPageDrop: (
    e: React.DragEvent<HTMLDivElement>,
    fileId: number,
    pageNum: number,
  ) => void;
  onFileDragStart: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onFileDragOver: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onFileDrop: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onRotatePage: (
    fileId: number,
    pageNum: number,
    direction: "left" | "right",
  ) => void;
  onRemovePageSingle: (fileId: number, pageNum: number) => void;
  onDuplicatePage: (fileId: number, pageNum: number) => void;
  onInsertBlankPage: (fileId: number, pageNum: number) => void;
}

export default function FileCard({
  data,
  index,
  selectedPages,
  thumbSize = "md",
  onRemoveFile,
  onSelectPage,
  onSelectAll,
  onPageDragStart,
  onPageDragEnd,
  onPageDragOver,
  onPageDrop,
  onFileDragStart,
  onFileDragOver,
  onFileDrop,
  onRotatePage,
  onRemovePageSingle,
  onDuplicatePage,
  onInsertBlankPage,
}: FileCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isDragOver = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const selectedInThisFile = selectedPages.filter((p) => p.id === data.id);
  const allSelected =
    data.pageOrder.length > 0 &&
    data.pageOrder.every((pageNum) =>
      selectedPages.some((p) => p.id === data.id && p.pageNum === pageNum),
    );

  function handleFileDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!isDragOver.current && cardRef.current) {
      isDragOver.current = true;
      cardRef.current.classList.add("drag-over");
    }
    onFileDragOver(e, index);
  }

  function handleFileDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!cardRef.current?.contains(e.relatedTarget as Node)) {
      isDragOver.current = false;
      cardRef.current?.classList.remove("drag-over");
    }
  }

  function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    isDragOver.current = false;
    cardRef.current?.classList.remove("drag-over");
    onFileDrop(e, index);
  }

  const visiblePageCount = data.pageOrder.filter(
    (p) => !data.removePages.includes(p),
  ).length;

  return (
    <div
      ref={cardRef}
      data-ocid={`file.item.${index + 1}`}
      draggable
      onDragStart={(e) => onFileDragStart(e, index)}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
      className="bg-card border border-border rounded-lg shadow-card overflow-hidden no-select"
    >
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-border">
        {/* Clickable collapse area */}
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => setIsCollapsed((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm truncate max-w-xs">
              {data.file.name}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {visiblePageCount} of {data.pageOrder.length} pages
              {data.removePages.length > 0 && (
                <span className="text-destructive ml-1">
                  · {data.removePages.length} removed
                </span>
              )}
              {selectedInThisFile.length > 0 && (
                <span className="text-primary ml-1">
                  · {selectedInThisFile.length} selected
                </span>
              )}
            </p>
          </div>
          <span aria-hidden className="text-muted-foreground shrink-0">
            {isCollapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </span>
        </button>

        {/* Action buttons — not part of collapse trigger */}
        <div className="flex items-center gap-1.5 px-3 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectAll(data.id)}
            className={cn(
              "text-xs h-7 px-2",
              allSelected ? "text-primary" : "text-muted-foreground",
            )}
            data-ocid={`file.item.${index + 1}.button`}
          >
            {allSelected ? "Deselect" : "Select All"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemoveFile(index)}
            className="w-7 h-7 p-0 text-muted-foreground hover:text-destructive"
            data-ocid={`file.item.${index + 1}.delete_button`}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Thumbnails grid */}
      {!isCollapsed && (
        <div className="p-4">
          {data.pageOrder.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No pages
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {data.pageOrder.map((pageNum, thumbIdx) => (
                <PageThumb
                  key={`${data.id}-${pageNum}`}
                  fileId={data.id}
                  pageNum={pageNum}
                  thumbnail={data.thumbnails[thumbIdx]}
                  isSelected={selectedPages.some(
                    (p) => p.id === data.id && p.pageNum === pageNum,
                  )}
                  isRemoved={data.removePages.includes(pageNum)}
                  size={thumbSize}
                  positionIndex={thumbIdx + 1}
                  onSelect={onSelectPage}
                  onDragStart={onPageDragStart}
                  onDragEnd={onPageDragEnd}
                  onDragOver={onPageDragOver}
                  onDrop={onPageDrop}
                  index={thumbIdx + 1}
                  onRotateLeft={(fid, pn) => onRotatePage(fid, pn, "left")}
                  onRotateRight={(fid, pn) => onRotatePage(fid, pn, "right")}
                  onDuplicate={onDuplicatePage}
                  onRemove={onRemovePageSingle}
                  onInsertBlankPage={onInsertBlankPage}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Collapsed summary */}
      {isCollapsed && (
        <div className="px-4 py-2 text-xs text-muted-foreground">
          {visiblePageCount} of {data.pageOrder.length} page
          {data.pageOrder.length !== 1 ? "s" : ""} · click header to expand
        </div>
      )}
    </div>
  );
}
