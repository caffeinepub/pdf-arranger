import DropZone from "@/components/DropZone";
import FileCard from "@/components/FileCard";
import Toolbar from "@/components/Toolbar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileText, Heart } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface FileData {
  id: number;
  file: File;
  pageCount: number;
  pageOrder: number[];
  rotations: number[];
  removePages: number[];
  thumbnails: (string | null)[];
}

export interface SelectedPage {
  id: number;
  pageNum: number;
}

type ThumbSize = "sm" | "md" | "lg";

// Initialize pdf.js worker
function initPdfJsWorker() {
  if (typeof window !== "undefined" && window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
  }
}

async function renderPageThumbnail(
  file: File,
  pageNum: number,
  rotation: number,
): Promise<string> {
  initPdfJsWorker();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const typedArray = new Uint8Array(reader.result as ArrayBuffer);
        const pdf = await window.pdfjsLib.getDocument({ data: typedArray })
          .promise;
        const page = await pdf.getPage(pageNum);
        const scale = 0.4;
        const viewport = page.getViewport({ scale, rotation: rotation || 0 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function loadPdfPageCount(file: File): Promise<number> {
  initPdfJsWorker();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const typedArray = new Uint8Array(reader.result as ArrayBuffer);
        const pdf = await window.pdfjsLib.getDocument({ data: typedArray })
          .promise;
        resolve(pdf.numPages);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export default function App() {
  const [filesData, setFilesData] = useState<FileData[]>([]);
  const [selectedPages, setSelectedPages] = useState<SelectedPage[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [outputFilename, setOutputFilename] = useState("merged");
  const [thumbSize, setThumbSize] = useState<ThumbSize>("md");
  const [isDraggingPage, setIsDraggingPage] = useState(false);
  const [draggingPageCount, setDraggingPageCount] = useState(0);

  // Undo stack — stores up to 10 snapshots of filesData
  const undoStack = useRef<FileData[][]>([]);

  // Stable ref to filesData for use inside stable callbacks
  const filesDataRef = useRef<FileData[]>(filesData);
  filesDataRef.current = filesData;

  // Stable ref to selectedPages for use inside stable callbacks
  const selectedPagesRef = useRef<SelectedPage[]>(selectedPages);
  selectedPagesRef.current = selectedPages;

  // Stable ref to pushUndo so it never changes identity
  const pushUndoRef = useRef((snapshot: FileData[]) => {
    undoStack.current = [
      ...undoStack.current.slice(-9),
      snapshot.map((f) => ({
        ...f,
        pageOrder: [...f.pageOrder],
        rotations: [...f.rotations],
        removePages: [...f.removePages],
        thumbnails: [...f.thumbnails],
      })),
    ];
  });

  function pushUndo(snapshot: FileData[]) {
    pushUndoRef.current(snapshot);
  }

  // Last selected page per file (for shift+click range selection)
  const lastSelectedPage = useRef<Record<number, number | null>>({});

  // Drag refs (avoid stale closures)
  const draggedFileIndex = useRef<number | null>(null);
  // Now holds ALL pages being dragged (multi-select support)
  const draggedPages = useRef<SelectedPage[] | null>(null);
  const addMoreInputRef = useRef<HTMLInputElement>(null);

  function handleUndo() {
    if (undoStack.current.length === 0) {
      toast.info("Nothing to undo.");
      return;
    }
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    setFilesData(prev);
    toast.info("Undone.");
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }
      // Undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        handleRemovePage();
      } else if (e.key === "r" || e.key === "R") {
        if (!e.ctrlKey && !e.metaKey) {
          if (e.shiftKey) {
            handleRotateLeft();
          } else {
            handleRotateRight();
          }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Click outside to deselect
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        !target.closest("[data-ocid^='page.']") &&
        !target.closest("[data-ocid^='toolbar.']") &&
        !target.closest("[data-ocid^='file.item']")
      ) {
        setSelectedPages([]);
      }
    }
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function renderAllThumbnails(fileData: FileData) {
    const promises = fileData.pageOrder.map(async (pageNum) => {
      try {
        const dataUrl = await renderPageThumbnail(
          fileData.file,
          pageNum,
          fileData.rotations[pageNum - 1] || 0,
        );
        setFilesData((prev) =>
          prev.map((f) => {
            if (f.id !== fileData.id) return f;
            const newThumbs = [...f.thumbnails];
            newThumbs[pageNum - 1] = dataUrl;
            return { ...f, thumbnails: newThumbs };
          }),
        );
      } catch {
        // thumbnail stays null
      }
    });
    await Promise.all(promises);
  }

  async function addFiles(files: File[]) {
    const pdfFiles = files.filter((f) => f.type === "application/pdf");
    if (pdfFiles.length === 0) {
      toast.error("Please upload valid PDF files.");
      return;
    }

    const newEntries: FileData[] = [];
    for (const file of pdfFiles) {
      try {
        const pageCount = await loadPdfPageCount(file);
        const entry: FileData = {
          id: Date.now() + Math.random(),
          file,
          pageCount,
          pageOrder: Array.from({ length: pageCount }, (_, i) => i + 1),
          rotations: new Array(pageCount).fill(0),
          removePages: [],
          thumbnails: new Array(pageCount).fill(null),
        };
        newEntries.push(entry);
      } catch {
        toast.error(`Failed to load ${file.name}`);
      }
    }

    if (newEntries.length === 0) return;

    setFilesData((prev) => [...prev, ...newEntries]);

    for (const entry of newEntries) {
      renderAllThumbnails(entry);
    }
  }

  function handleAddMoreFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    addFiles(files);
    e.target.value = "";
  }

  function handleRemoveFile(index: number) {
    setFilesData((prev) => {
      const removed = prev[index];
      setSelectedPages((sp) => sp.filter((p) => p.id !== removed.id));
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleSelectPage(page: SelectedPage, e?: React.MouseEvent) {
    const fileId = page.id;
    const pageNum = page.pageNum;

    if (e?.shiftKey) {
      const file = filesData.find((f) => f.id === fileId);
      if (!file) return;
      const lastPage = lastSelectedPage.current[fileId];
      if (lastPage != null) {
        const fromIdx = file.pageOrder.indexOf(lastPage);
        const toIdx = file.pageOrder.indexOf(pageNum);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [start, end] =
            fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
          const rangePages = file.pageOrder.slice(start, end + 1);
          setSelectedPages((prev) => {
            const withoutFile = prev.filter((p) => p.id !== fileId);
            const newSel = rangePages.map((pn) => ({
              id: fileId,
              pageNum: pn,
            }));
            return [...withoutFile, ...newSel];
          });
          lastSelectedPage.current[fileId] = pageNum;
          return;
        }
      }
    }

    // Normal click
    setSelectedPages((prev) => {
      const idx = prev.findIndex(
        (p) => p.id === page.id && p.pageNum === page.pageNum,
      );
      if (idx > -1) {
        lastSelectedPage.current[fileId] = null;
        return prev.filter((_, i) => i !== idx);
      }
      lastSelectedPage.current[fileId] = pageNum;
      return [...prev, page];
    });
  }

  function handleSelectAllInFile(fileId: number) {
    const file = filesData.find((f) => f.id === fileId);
    if (!file) return;

    const allSelected = file.pageOrder.every((pageNum) =>
      selectedPages.some((p) => p.id === fileId && p.pageNum === pageNum),
    );

    if (allSelected) {
      setSelectedPages((prev) => prev.filter((p) => p.id !== fileId));
    } else {
      setSelectedPages((prev) => {
        const existing = prev.filter((p) => p.id !== fileId);
        const newOnes = file.pageOrder.map((pageNum) => ({
          id: fileId,
          pageNum,
        }));
        return [...existing, ...newOnes];
      });
    }
  }

  function handleSelectAllFiles() {
    const allPages: SelectedPage[] = [];
    for (const file of filesData) {
      for (const pageNum of file.pageOrder) {
        allPages.push({ id: file.id, pageNum });
      }
    }
    const totalPages = allPages.length;
    if (selectedPages.length === totalPages) {
      setSelectedPages([]);
    } else {
      setSelectedPages(allPages);
    }
  }

  function handleRotate(direction: "left" | "right") {
    if (selectedPages.length === 0) return;
    pushUndo(filesData);
    const delta = direction === "right" ? 90 : -90;
    setFilesData((prev) =>
      prev.map((file) => {
        const affected = selectedPages.filter((p) => p.id === file.id);
        if (affected.length === 0) return file;
        const newRotations = [...file.rotations];
        for (const { pageNum } of affected) {
          const posIdx = file.pageOrder.indexOf(pageNum);
          if (posIdx === -1) continue;
          newRotations[posIdx] =
            ((newRotations[posIdx] || 0) + delta + 360) % 360;
        }
        const updatedFile = { ...file, rotations: newRotations };
        for (const { pageNum } of affected) {
          const posIdx = file.pageOrder.indexOf(pageNum);
          if (posIdx === -1) continue;
          const rot = newRotations[posIdx];
          renderPageThumbnail(file.file, pageNum, rot).then((dataUrl) => {
            setFilesData((p) =>
              p.map((f) => {
                if (f.id !== file.id) return f;
                const thumbs = [...f.thumbnails];
                const tPos = f.pageOrder.indexOf(pageNum);
                if (tPos !== -1) thumbs[tPos] = dataUrl;
                return { ...f, thumbnails: thumbs };
              }),
            );
          });
        }
        return updatedFile;
      }),
    );
  }

  function handleRotateLeft() {
    handleRotate("left");
  }

  function handleRotateRight() {
    handleRotate("right");
  }

  function handleRemovePage() {
    if (selectedPages.length === 0) return;
    pushUndo(filesData);
    setFilesData((prev) =>
      prev.map((file) => {
        const affected = selectedPages
          .filter((p) => p.id === file.id)
          .map((p) => p.pageNum);
        if (affected.length === 0) return file;
        const newRemovePages = [...file.removePages];
        for (const pageNum of affected) {
          const idx = newRemovePages.indexOf(pageNum);
          if (idx === -1) {
            newRemovePages.push(pageNum);
          } else {
            newRemovePages.splice(idx, 1);
          }
        }
        return { ...file, removePages: newRemovePages };
      }),
    );
  }

  function handleRotatePageSingle(
    fileId: number,
    pageNum: number,
    direction: "left" | "right",
  ) {
    pushUndo(filesData);
    const delta = direction === "right" ? 90 : -90;
    setFilesData((prev) =>
      prev.map((file) => {
        if (file.id !== fileId) return file;
        const posIdx = file.pageOrder.indexOf(pageNum);
        if (posIdx === -1) return file;
        const newRotations = [...file.rotations];
        newRotations[posIdx] =
          ((newRotations[posIdx] || 0) + delta + 360) % 360;
        const updatedFile = { ...file, rotations: newRotations };
        renderPageThumbnail(file.file, pageNum, newRotations[posIdx]).then(
          (dataUrl) => {
            setFilesData((p) =>
              p.map((f) => {
                if (f.id !== file.id) return f;
                const thumbs = [...f.thumbnails];
                const tPos = f.pageOrder.indexOf(pageNum);
                if (tPos !== -1) thumbs[tPos] = dataUrl;
                return { ...f, thumbnails: thumbs };
              }),
            );
          },
        );
        return updatedFile;
      }),
    );
  }

  function handleRemovePageSingle(fileId: number, pageNum: number) {
    pushUndo(filesData);
    setFilesData((prev) =>
      prev.map((file) => {
        if (file.id !== fileId) return file;
        const newRemovePages = [...file.removePages];
        const idx = newRemovePages.indexOf(pageNum);
        if (idx === -1) {
          newRemovePages.push(pageNum);
        } else {
          newRemovePages.splice(idx, 1);
        }
        return { ...file, removePages: newRemovePages };
      }),
    );
  }

  function handleDuplicatePage(fileId: number, pageNum: number) {
    pushUndo(filesData);
    setFilesData((prev) =>
      prev.map((file) => {
        if (file.id !== fileId) return file;
        const newPageOrder = [...file.pageOrder];
        const newRotations = [...file.rotations];
        const newThumbnails = [...file.thumbnails];
        const posIdx = newPageOrder.indexOf(pageNum);
        if (posIdx === -1) return file;
        // Insert a copy right after the original — use a virtual page number
        const newPageNum = Math.max(...newPageOrder) + 1;
        newPageOrder.splice(posIdx + 1, 0, newPageNum);
        newRotations.splice(posIdx + 1, 0, newRotations[posIdx] || 0);
        newThumbnails.splice(posIdx + 1, 0, newThumbnails[posIdx] || null);
        return {
          ...file,
          pageOrder: newPageOrder,
          rotations: newRotations,
          thumbnails: newThumbnails,
        };
      }),
    );
    toast.success("Page duplicated.");
  }

  async function handleMerge() {
    if (filesData.length === 0) {
      toast.error("Add at least one PDF to merge.");
      return;
    }
    setIsMerging(true);
    setMergeProgress(10);
    try {
      const merged = await window.PDFLib.PDFDocument.create();
      setMergeProgress(20);
      for (const fileData of filesData) {
        const bytes = await fileData.file.arrayBuffer();
        const pdf = await window.PDFLib.PDFDocument.load(bytes);
        const keptPages = fileData.pageOrder.filter(
          (p) => !fileData.removePages.includes(p),
        );
        const indicesToCopy = keptPages.map((pageNum) => {
          // Handle duplicated/moved virtual pages (> original pageCount) by mapping back
          const realPage =
            pageNum > fileData.pageCount
              ? fileData.pageOrder[fileData.pageOrder.indexOf(pageNum) - 1] || 1
              : pageNum;
          return Math.min(realPage - 1, pdf.getPageCount() - 1);
        });
        const copiedPages = await merged.copyPages(pdf, indicesToCopy);
        setMergeProgress(50);
        copiedPages.forEach((page, i) => {
          const posIdx = fileData.pageOrder.indexOf(keptPages[i]);
          const rotation = posIdx !== -1 ? fileData.rotations[posIdx] || 0 : 0;
          page.setRotation(window.PDFLib.degrees(rotation));
          merged.addPage(page);
        });
      }
      setMergeProgress(90);
      const pdfBytes = await merged.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const filename = (outputFilename || "merged").trim();
      link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMergeProgress(100);
      toast.success("PDF merged and downloaded successfully!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to merge PDFs: ${msg}`);
    } finally {
      setTimeout(() => {
        setIsMerging(false);
        setMergeProgress(0);
      }, 600);
    }
  }

  // --- File drag-and-drop ---
  function handleFileDragStart(
    e: React.DragEvent<HTMLDivElement>,
    index: number,
  ) {
    draggedFileIndex.current = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `file:${index}`);
  }

  function handleFileDragOver(
    e: React.DragEvent<HTMLDivElement>,
    _index: number,
  ) {
    e.preventDefault();
  }

  function handleFileDrop(
    e: React.DragEvent<HTMLDivElement>,
    targetIndex: number,
  ) {
    e.preventDefault();
    const fromIndex = draggedFileIndex.current;
    if (fromIndex === null || fromIndex === targetIndex) return;
    pushUndo(filesData);
    setFilesData((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    draggedFileIndex.current = null;
  }

  // --- Page drag-and-drop (multi-select aware) ---
  function handlePageDragStart(
    e: React.DragEvent<HTMLDivElement>,
    fileId: number,
    pageNum: number,
  ) {
    // Use stable ref so we get the current selection at drag-start time
    const currentSelection = selectedPagesRef.current;
    const isDraggedPageSelected = currentSelection.some(
      (p) => p.id === fileId && p.pageNum === pageNum,
    );

    // If the dragged page is part of the current selection, drag all selected pages.
    // Otherwise, drag only this single page (don't change selection).
    const pagesToDrag: SelectedPage[] = isDraggedPageSelected
      ? currentSelection
      : [{ id: fileId, pageNum }];

    draggedPages.current = pagesToDrag;
    setIsDraggingPage(true);
    setDraggingPageCount(pagesToDrag.length);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "text/plain",
      `pages:${pagesToDrag.map((p) => `${p.id}:${p.pageNum}`).join(",")}`,
    );

    // Custom drag ghost for multi-page drags
    if (pagesToDrag.length > 1) {
      const ghost = document.createElement("div");
      ghost.style.cssText =
        "position:fixed;top:-9999px;left:-9999px;padding:6px 12px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-radius:6px;font-size:13px;font-weight:600;pointer-events:none;";
      ghost.textContent = `${pagesToDrag.length} pages`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 0, 0);
      setTimeout(() => document.body.removeChild(ghost), 0);
    }
  }

  function handlePageDragEnd() {
    setIsDraggingPage(false);
    setDraggingPageCount(0);
    draggedPages.current = null;
  }

  function handlePageDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  // -1 as targetPageNum is the sentinel meaning "append to end"
  const handlePageDrop = useCallback(
    (
      e: React.DragEvent<HTMLDivElement>,
      targetFileId: number,
      targetPageNum: number,
    ) => {
      e.preventDefault();
      const dragged = draggedPages.current;
      if (!dragged || dragged.length === 0) return;

      // Use stable refs to avoid needing filesData in deps
      pushUndoRef.current(filesDataRef.current);

      setFilesData((prev) => {
        const next = prev.map((f) => ({
          ...f,
          pageOrder: [...f.pageOrder],
          rotations: [...f.rotations],
          thumbnails: [...f.thumbnails],
        }));

        // Group dragged pages by source file, preserving their relative order
        // within each source file
        const bySourceFile = new Map<number, number[]>();
        for (const dp of dragged) {
          if (!bySourceFile.has(dp.id)) bySourceFile.set(dp.id, []);
          bySourceFile.get(dp.id)!.push(dp.pageNum);
        }

        // Collect all (pageNum, rotation, thumbnail) to be inserted at destination,
        // in the order they appear across source files (source file order from `next`)
        const pagesPayload: Array<{
          pageNum: number;
          rotation: number;
          thumbnail: string | null;
        }> = [];

        // Iterate source files in the same order they appear in `next`
        for (const srcFile of next) {
          const srcPageNums = bySourceFile.get(srcFile.id);
          if (!srcPageNums) continue;

          // Sort them by their current position in the file's pageOrder
          const sorted = [...srcPageNums].sort(
            (a, b) =>
              srcFile.pageOrder.indexOf(a) - srcFile.pageOrder.indexOf(b),
          );

          // Collect and remove from source
          for (const pageNum of sorted) {
            const srcIdx = srcFile.pageOrder.indexOf(pageNum);
            if (srcIdx === -1) continue;
            pagesPayload.push({
              pageNum,
              rotation: srcFile.rotations[srcIdx] ?? 0,
              thumbnail: srcFile.thumbnails[srcIdx] ?? null,
            });
          }
        }

        // Now remove them all from their source files
        for (const srcFile of next) {
          const srcPageNums = bySourceFile.get(srcFile.id);
          if (!srcPageNums) continue;
          for (const pageNum of srcPageNums) {
            const srcIdx = srcFile.pageOrder.indexOf(pageNum);
            if (srcIdx === -1) continue;
            srcFile.pageOrder.splice(srcIdx, 1);
            srcFile.rotations.splice(srcIdx, 1);
            srcFile.thumbnails.splice(srcIdx, 1);
          }
        }

        // Insert all pages into target file at drop position
        const tgtFile = next.find((f) => f.id === targetFileId);
        if (!tgtFile) return prev;

        if (targetPageNum === -1) {
          // Append to end
          for (const payload of pagesPayload) {
            tgtFile.pageOrder.push(payload.pageNum);
            tgtFile.rotations.push(payload.rotation);
            tgtFile.thumbnails.push(payload.thumbnail);
          }
        } else {
          // Find the drop index — note: we already removed source pages so index may have shifted
          let tgtIdx = tgtFile.pageOrder.indexOf(targetPageNum);
          if (tgtIdx === -1) {
            // target page was removed (it was one of the dragged pages, edge case)
            // append to end of target
            for (const payload of pagesPayload) {
              tgtFile.pageOrder.push(payload.pageNum);
              tgtFile.rotations.push(payload.rotation);
              tgtFile.thumbnails.push(payload.thumbnail);
            }
          } else {
            // Insert all pages starting at tgtIdx, preserving order
            for (let i = 0; i < pagesPayload.length; i++) {
              const payload = pagesPayload[i];
              tgtFile.pageOrder.splice(tgtIdx + i, 0, payload.pageNum);
              tgtFile.rotations.splice(tgtIdx + i, 0, payload.rotation);
              tgtFile.thumbnails.splice(tgtIdx + i, 0, payload.thumbnail);
            }
          }
        }

        return next;
      });

      draggedPages.current = null;
      setIsDraggingPage(false);
      setDraggingPageCount(0);
    },
    [],
  );

  const hasFiles = filesData.length > 0;
  const hasSelection = selectedPages.length > 0;
  const year = new Date().getFullYear();

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-background">
        <Toaster position="top-right" richColors />

        {/* Header */}
        <header className="bg-header sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-6 h-6 text-primary" />
              <span className="text-header-foreground font-bold text-xl tracking-tight">
                PDF Arranger
              </span>
            </div>
            <span className="text-header-foreground/50 text-xs hidden sm:block">
              Merge · Rotate · Reorder · Remove
            </span>
          </div>
        </header>

        {/* Toolbar */}
        <Toolbar
          hasFiles={hasFiles}
          hasSelection={hasSelection}
          isMerging={isMerging}
          outputFilename={outputFilename}
          thumbSize={thumbSize}
          onFilenameChange={setOutputFilename}
          onThumbSizeChange={setThumbSize}
          onAddPDF={() => {
            const input = document.querySelector<HTMLInputElement>(
              "[data-ocid='dropzone.dropzone'] input[type='file']",
            );
            if (input) {
              input.click();
            } else {
              addMoreInputRef.current?.click();
            }
          }}
          onMerge={handleMerge}
          onRotateLeft={handleRotateLeft}
          onRotateRight={handleRotateRight}
          onRemovePage={handleRemovePage}
          onSelectAll={handleSelectAllFiles}
          onUndo={handleUndo}
        />

        {/* Merge progress bar */}
        {isMerging && (
          <div className="h-[3px] bg-border overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${mergeProgress}%` }}
            />
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 py-6 px-4">
          <div className="max-w-7xl mx-auto">
            {!hasFiles ? (
              <div data-ocid="files.empty_state">
                <DropZone onFilesAdded={addFiles} />
              </div>
            ) : (
              <div className="space-y-4">
                {/* File cards grid */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {filesData.map((fileData, index) => (
                    <FileCard
                      key={fileData.id}
                      data={fileData}
                      index={index}
                      selectedPages={selectedPages}
                      thumbSize={thumbSize}
                      isDraggingPage={isDraggingPage}
                      draggingPageCount={draggingPageCount}
                      onRemoveFile={handleRemoveFile}
                      onSelectPage={handleSelectPage}
                      onSelectAll={handleSelectAllInFile}
                      onPageDragStart={handlePageDragStart}
                      onPageDragEnd={handlePageDragEnd}
                      onPageDragOver={handlePageDragOver}
                      onPageDrop={handlePageDrop}
                      onFileDragStart={handleFileDragStart}
                      onFileDragOver={handleFileDragOver}
                      onFileDrop={handleFileDrop}
                      onRotatePage={handleRotatePageSingle}
                      onRemovePageSingle={handleRemovePageSingle}
                      onDuplicatePage={handleDuplicatePage}
                    />
                  ))}
                </div>

                {/* Bottom add-more dropzone */}
                <label
                  data-ocid="add.dropzone"
                  className="border-2 border-dashed border-border rounded-xl p-6 flex items-center justify-center gap-3 cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-all outline-none focus-within:ring-2 focus-within:ring-primary block"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add(
                      "border-primary",
                      "bg-primary/5",
                    );
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove(
                      "border-primary",
                      "bg-primary/5",
                    );
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove(
                      "border-primary",
                      "bg-primary/5",
                    );
                    const files = Array.from(e.dataTransfer.files).filter(
                      (f) => f.type === "application/pdf",
                    );
                    if (files.length > 0) addFiles(files);
                  }}
                >
                  <input
                    ref={addMoreInputRef}
                    type="file"
                    accept="application/pdf"
                    multiple
                    className="sr-only"
                    onChange={handleAddMoreFileInput}
                  />
                  <span className="text-sm text-muted-foreground">
                    + Drop or click to add more PDFs
                  </span>
                </label>
              </div>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-border py-4 px-4 mt-auto">
          <div className="max-w-7xl mx-auto text-center text-xs text-muted-foreground">
            © {year}. Built with{" "}
            <Heart className="inline w-3 h-3 text-destructive mx-0.5" /> using{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(typeof window !== "undefined" ? window.location.hostname : "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              caffeine.ai
            </a>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
