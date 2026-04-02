import type { SelectedPage } from "@/App";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import {
  Check,
  Copy,
  Loader2,
  RotateCcw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useRef } from "react";

type ThumbSize = "sm" | "md" | "lg";

const THUMB_DIMENSIONS: Record<ThumbSize, { w: number; h: number }> = {
  sm: { w: 80, h: 106 },
  md: { w: 110, h: 147 },
  lg: { w: 140, h: 186 },
};

interface PageThumbProps {
  fileId: number;
  pageNum: number;
  thumbnail: string | null;
  isSelected: boolean;
  isRemoved: boolean;
  size?: ThumbSize;
  positionIndex: number; // 1-based position in current order
  onSelect: (page: SelectedPage, e: React.MouseEvent) => void;
  onDragStart: (
    e: React.DragEvent<HTMLDivElement>,
    fileId: number,
    pageNum: number,
  ) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (
    e: React.DragEvent<HTMLDivElement>,
    fileId: number,
    pageNum: number,
  ) => void;
  index: number;
  onRotateLeft: (fileId: number, pageNum: number) => void;
  onRotateRight: (fileId: number, pageNum: number) => void;
  onDuplicate: (fileId: number, pageNum: number) => void;
  onRemove: (fileId: number, pageNum: number) => void;
}

export default function PageThumb({
  fileId,
  pageNum,
  thumbnail,
  isSelected,
  isRemoved,
  size = "md",
  positionIndex,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  index,
  onRotateLeft,
  onRotateRight,
  onDuplicate,
  onRemove,
}: PageThumbProps) {
  const isDragOver = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dims = THUMB_DIMENSIONS[size];

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!isDragOver.current && wrapperRef.current) {
      isDragOver.current = true;
      wrapperRef.current.classList.add("page-drag-over");
    }
    onDragOver(e);
  }

  function handleDragLeave() {
    if (wrapperRef.current) {
      isDragOver.current = false;
      wrapperRef.current.classList.remove("page-drag-over");
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (wrapperRef.current) {
      isDragOver.current = false;
      wrapperRef.current.classList.remove("page-drag-over");
    }
    onDrop(e, fileId, pageNum);
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect({ id: fileId, pageNum }, e);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onSelect({ id: fileId, pageNum }, e as unknown as React.MouseEvent);
    }
  }

  // Show original page number as sub-label only if different from position
  const showOriginal = pageNum !== positionIndex;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={wrapperRef}
          data-ocid={`page.item.${index}`}
          draggable
          onDragStart={(e) =>
            onDragStart(
              e as unknown as React.DragEvent<HTMLDivElement>,
              fileId,
              pageNum,
            )
          }
          onDragEnd={onDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="relative flex flex-col items-center gap-1 select-none group"
        >
          <button
            type="button"
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            className={cn(
              "relative rounded overflow-hidden shadow-thumb border-2 transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary",
              isSelected && "border-primary ring-2 ring-primary/40",
              isRemoved && !isSelected && "border-destructive",
              !isSelected && !isRemoved && "border-border",
            )}
            style={{ width: `${dims.w}px`, height: `${dims.h}px` }}
          >
            {thumbnail ? (
              <img
                src={thumbnail}
                alt={`Page ${pageNum}`}
                className="w-full h-full object-contain bg-white thumb-animate"
                draggable={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-muted">
                <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
              </div>
            )}

            {/* Selected badge */}
            {isSelected && (
              <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow">
                <Check className="w-3 h-3 text-white" strokeWidth={3} />
              </div>
            )}

            {/* Removed overlay */}
            {isRemoved && (
              <>
                <div className="absolute inset-0 bg-destructive/40" />
                <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-destructive flex items-center justify-center shadow">
                  <X className="w-3 h-3 text-white" strokeWidth={3} />
                </div>
                {/* Restore hover label */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="bg-background/90 text-foreground text-[10px] font-semibold px-2 py-1 rounded shadow">
                    Restore
                  </span>
                </div>
              </>
            )}
          </button>

          {/* Page labels */}
          <div className="flex flex-col items-center">
            <span className="text-xs text-foreground font-semibold leading-none">
              {positionIndex}
            </span>
            {showOriginal && (
              <span className="text-[10px] text-muted-foreground leading-none mt-0.5">
                p.{pageNum}
              </span>
            )}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onClick={() => onRotateLeft(fileId, pageNum)}
          className="gap-2 cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          Rotate Left
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onRotateRight(fileId, pageNum)}
          className="gap-2 cursor-pointer"
        >
          <RotateCw className="w-4 h-4" />
          Rotate Right
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onDuplicate(fileId, pageNum)}
          className="gap-2 cursor-pointer"
        >
          <Copy className="w-4 h-4" />
          Duplicate Page
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => onRemove(fileId, pageNum)}
          className={cn(
            "gap-2 cursor-pointer",
            isRemoved ? "text-primary" : "text-destructive",
          )}
        >
          <Trash2 className="w-4 h-4" />
          {isRemoved ? "Restore Page" : "Remove Page"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
