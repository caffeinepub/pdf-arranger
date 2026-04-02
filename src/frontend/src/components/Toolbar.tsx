import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ArrowRightLeft,
  CheckSquare,
  Download,
  FilePlus,
  HelpCircle,
  Loader2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
} from "lucide-react";

type ThumbSize = "sm" | "md" | "lg";

interface ToolbarProps {
  hasFiles: boolean;
  hasSelection: boolean;
  isMerging: boolean;
  outputFilename: string;
  thumbSize: ThumbSize;
  onFilenameChange: (v: string) => void;
  onThumbSizeChange: (v: ThumbSize) => void;
  onAddPDF: () => void;
  onMerge: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onRemovePage: () => void;
  onSelectAll: () => void;
  onUndo: () => void;
  onMovePages: () => void;
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
  dataOcid?: string;
  loading?: boolean;
}

function ToolButton({
  icon,
  label,
  onClick,
  disabled = false,
  variant = "default",
  dataOcid,
  loading = false,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      data-ocid={dataOcid}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "flex flex-col items-center gap-1 px-3 py-2 rounded-md transition-all duration-150",
        "text-toolbar-foreground text-[11px] font-medium min-w-[58px]",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "default" &&
          !disabled &&
          "hover:bg-white/10 active:bg-white/20",
        variant === "primary" &&
          !disabled &&
          "bg-primary/90 hover:bg-primary text-white",
        variant === "danger" &&
          !disabled &&
          "hover:bg-destructive/20 hover:text-red-300",
      )}
    >
      <span className="w-5 h-5 flex items-center justify-center">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

export default function Toolbar({
  hasFiles,
  hasSelection,
  isMerging,
  outputFilename,
  thumbSize,
  onFilenameChange,
  onThumbSizeChange,
  onAddPDF,
  onMerge,
  onRotateLeft,
  onRotateRight,
  onRemovePage,
  onSelectAll,
  onUndo,
  onMovePages,
}: ToolbarProps) {
  return (
    <div className="bg-toolbar sticky top-[56px] z-40">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center gap-1 py-1.5 flex-wrap">
          {/* Left group: Add PDF */}
          <ToolButton
            icon={<FilePlus className="w-4 h-4" />}
            label="Add PDF"
            onClick={onAddPDF}
            dataOcid="toolbar.upload_button"
          />

          <div className="w-px h-7 bg-white/10 mx-0.5" />

          {/* Edit group */}
          <ToolButton
            icon={<RotateCcw className="w-4 h-4" />}
            label="Rotate ←"
            onClick={onRotateLeft}
            disabled={!hasSelection}
            dataOcid="toolbar.rotate_left.button"
          />
          <ToolButton
            icon={<RotateCw className="w-4 h-4" />}
            label="Rotate →"
            onClick={onRotateRight}
            disabled={!hasSelection}
            dataOcid="toolbar.rotate_right.button"
          />
          <ToolButton
            icon={<Trash2 className="w-4 h-4" />}
            label="Remove"
            onClick={onRemovePage}
            disabled={!hasSelection}
            variant="danger"
            dataOcid="toolbar.delete_button"
          />
          <ToolButton
            icon={<ArrowRightLeft className="w-4 h-4" />}
            label="Move To"
            onClick={onMovePages}
            disabled={!hasSelection}
            dataOcid="toolbar.move_button"
          />
          <ToolButton
            icon={<Undo2 className="w-4 h-4" />}
            label="Undo"
            onClick={onUndo}
            disabled={!hasFiles}
            dataOcid="toolbar.secondary_button"
          />

          <div className="w-px h-7 bg-white/10 mx-0.5" />

          {/* Select + size group */}
          <ToolButton
            icon={<CheckSquare className="w-4 h-4" />}
            label="Select All"
            onClick={onSelectAll}
            disabled={!hasFiles}
            dataOcid="toolbar.toggle"
          />

          {/* Thumbnail size toggle */}
          <div className="flex flex-col items-center gap-0.5 px-1 py-1">
            <ToggleGroup
              type="single"
              value={thumbSize}
              onValueChange={(v) => {
                if (v) onThumbSizeChange(v as ThumbSize);
              }}
              className="gap-0.5"
              data-ocid="toolbar.toggle"
            >
              <ToggleGroupItem
                value="sm"
                className="h-6 w-8 text-[10px] text-toolbar-foreground data-[state=on]:bg-white/20 data-[state=on]:text-white hover:bg-white/10 rounded px-1"
              >
                S
              </ToggleGroupItem>
              <ToggleGroupItem
                value="md"
                className="h-6 w-8 text-[10px] text-toolbar-foreground data-[state=on]:bg-white/20 data-[state=on]:text-white hover:bg-white/10 rounded px-1"
              >
                M
              </ToggleGroupItem>
              <ToggleGroupItem
                value="lg"
                className="h-6 w-8 text-[10px] text-toolbar-foreground data-[state=on]:bg-white/20 data-[state=on]:text-white hover:bg-white/10 rounded px-1"
              >
                L
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="text-[10px] text-toolbar-foreground/60">Size</span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Filename input */}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={outputFilename}
              onChange={(e) => onFilenameChange(e.target.value)}
              placeholder="merged"
              data-ocid="toolbar.input"
              className={cn(
                "h-8 w-36 px-2 py-1 rounded text-sm bg-white/10 border border-white/15",
                "text-toolbar-foreground placeholder-toolbar-foreground/40",
                "focus:outline-none focus:ring-1 focus:ring-primary/60 focus:border-primary/60",
                "transition-colors",
              )}
              aria-label="Output filename"
            />
            <span className="text-toolbar-foreground/50 text-xs">.pdf</span>
          </div>

          {/* Merge button */}
          <ToolButton
            icon={<Download className="w-4 h-4" />}
            label={isMerging ? "Merging..." : "Merge & Download"}
            onClick={onMerge}
            disabled={!hasFiles || isMerging}
            variant="primary"
            loading={isMerging}
            dataOcid="toolbar.primary_button"
          />

          {/* Help button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="toolbar.button"
                className="flex flex-col items-center gap-1 px-2 py-2 rounded-md transition-all text-toolbar-foreground/60 hover:text-toolbar-foreground hover:bg-white/10 text-[11px]"
                aria-label="Keyboard shortcuts"
              >
                <HelpCircle className="w-4 h-4" />
                <span>Help</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="p-3 max-w-[220px]">
              <p className="font-semibold mb-2 text-xs">Keyboard Shortcuts</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Rotate right</span>
                  <kbd className="bg-muted px-1.5 rounded text-[10px] font-mono">
                    R
                  </kbd>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Rotate left</span>
                  <kbd className="bg-muted px-1.5 rounded text-[10px] font-mono">
                    Shift+R
                  </kbd>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">
                    Remove / Restore
                  </span>
                  <kbd className="bg-muted px-1.5 rounded text-[10px] font-mono">
                    Del
                  </kbd>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Undo</span>
                  <kbd className="bg-muted px-1.5 rounded text-[10px] font-mono">
                    Ctrl+Z
                  </kbd>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Range select</span>
                  <kbd className="bg-muted px-1.5 rounded text-[10px] font-mono">
                    Shift+click
                  </kbd>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
