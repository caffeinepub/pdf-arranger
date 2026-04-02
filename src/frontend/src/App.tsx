import DropZone from "@/components/DropZone";
import FileCard from "@/components/FileCard";
import MoveDialog from "@/components/MoveDialog";
import Toolbar from "@/components/Toolbar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileText, Heart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);

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
  // Single page being dragged
  const draggedPage = useRef<{ fileId: number; pageNum: number } | null>(null);
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
        !target.closest("[data-ocid^='file.item']") &&
        !target.closest("[role='dialog']")
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

  /**
   * Move selected pages to a specific position within a target file.
   * targetPosition: 0 = beginning, N = after the Nth active (non-removed) page.
   *
   * The dialog builds positionOptions based on active pages only, so we
   * must translate targetPosition into a raw pageOrder index here.
   */
  function handleMovePages(targetFileId: number, targetPosition: number) {
    // Work from current filesData synchronously via the ref
    const current = filesDataRef.current;
    pushUndo(current);

    // Build the set of pages to move per source file
    const bySourceFile = new Map<number, Set<number>>();
    for (const p of selectedPagesRef.current) {
      if (!bySourceFile.has(p.id)) bySourceFile.set(p.id, new Set());
      bySourceFile.get(p.id)!.add(p.pageNum);
    }

    // Helper: collect ordered page entries for pages being moved from a file
    interface PageEntry {
      pageNum: number;
      rotation: number;
      thumbnail: string | null;
    }

    function extractPages(file: FileData, movingSet: Set<number>): PageEntry[] {
      const entries: PageEntry[] = [];
      for (let i = 0; i < file.pageOrder.length; i++) {
        const pn = file.pageOrder[i];
        if (movingSet.has(pn)) {
          entries.push({
            pageNum: pn,
            rotation: file.rotations[i] ?? 0,
            thumbnail: file.thumbnails[i] ?? null,
          });
        }
      }
      return entries;
    }

    // Collect all pages to insert, preserving cross-file order by source order
    const pagesToInsert: PageEntry[] = [];
    for (const file of current) {
      const movingSet = bySourceFile.get(file.id);
      if (!movingSet || movingSet.size === 0) continue;
      pagesToInsert.push(...extractPages(file, movingSet));
    }

    if (pagesToInsert.length === 0) return;

    // Build updated files
    const updatedFiles = current.map((file) => {
      const movingSet = bySourceFile.get(file.id);
      const isTarget = file.id === targetFileId;
      const isSource = movingSet && movingSet.size > 0;

      if (!isTarget && !isSource) return file;

      if (isTarget && isSource) {
        // Same-file move: remove the moving pages first, then reinsert
        const sameFileMoving = new Set(
          extractPages(file, movingSet!).map((e) => e.pageNum),
        );
        // Build arrays without moving pages
        const remainOrder: number[] = [];
        const remainRot: number[] = [];
        const remainThumb: (string | null)[] = [];
        for (let i = 0; i < file.pageOrder.length; i++) {
          if (!sameFileMoving.has(file.pageOrder[i])) {
            remainOrder.push(file.pageOrder[i]);
            remainRot.push(file.rotations[i] ?? 0);
            remainThumb.push(file.thumbnails[i] ?? null);
          }
        }
        // targetPosition is an index into the active (non-removed) pages of the
        // ORIGINAL file. We need to map it to an index in remainOrder.
        // Active pages in original order (excluding moving pages):
        const activeRemain = remainOrder.filter(
          (p) => !file.removePages.includes(p),
        );
        // insertAfterPageNum: the active page after which we insert (or null = beginning)
        const insertAfterActive =
          targetPosition > 0 ? activeRemain[targetPosition - 1] : null;
        let insertIdx: number;
        if (insertAfterActive == null) {
          insertIdx = 0;
        } else {
          insertIdx = remainOrder.lastIndexOf(insertAfterActive) + 1;
        }
        insertIdx = Math.min(insertIdx, remainOrder.length);

        // Only insert pages that belong to this same-file move
        const toInsert = pagesToInsert.filter((e) =>
          sameFileMoving.has(e.pageNum),
        );
        remainOrder.splice(insertIdx, 0, ...toInsert.map((e) => e.pageNum));
        remainRot.splice(insertIdx, 0, ...toInsert.map((e) => e.rotation));
        remainThumb.splice(insertIdx, 0, ...toInsert.map((e) => e.thumbnail));

        return {
          ...file,
          pageOrder: remainOrder,
          rotations: remainRot,
          thumbnails: remainThumb,
        };
      }

      if (isTarget && !isSource) {
        // Pure target (cross-file): insert the pages from other files
        const newOrder = [...file.pageOrder];
        const newRot = [...file.rotations];
        const newThumb = [...file.thumbnails];
        // targetPosition is index into active pages of the target file
        const activePages = newOrder.filter(
          (p) => !file.removePages.includes(p),
        );
        const insertAfterActive =
          targetPosition > 0 ? activePages[targetPosition - 1] : null;
        let insertIdx: number;
        if (insertAfterActive == null) {
          insertIdx = 0;
        } else {
          insertIdx = newOrder.lastIndexOf(insertAfterActive) + 1;
        }
        insertIdx = Math.min(insertIdx, newOrder.length);

        newOrder.splice(insertIdx, 0, ...pagesToInsert.map((e) => e.pageNum));
        newRot.splice(insertIdx, 0, ...pagesToInsert.map((e) => e.rotation));
        newThumb.splice(insertIdx, 0, ...pagesToInsert.map((e) => e.thumbnail));

        return {
          ...file,
          pageOrder: newOrder,
          rotations: newRot,
          thumbnails: newThumb,
        };
      }

      // Source only (cross-file): remove the moving pages
      const newOrder: number[] = [];
      const newRot: number[] = [];
      const newThumb: (string | null)[] = [];
      for (let i = 0; i < file.pageOrder.length; i++) {
        if (!movingSet!.has(file.pageOrder[i])) {
          newOrder.push(file.pageOrder[i]);
          newRot.push(file.rotations[i] ?? 0);
          newThumb.push(file.thumbnails[i] ?? null);
        }
      }
      return {
        ...file,
        pageOrder: newOrder,
        rotations: newRot,
        thumbnails: newThumb,
      };
    });

    setFilesData(updatedFiles);
    setSelectedPages([]);
    setIsMoveDialogOpen(false);
    toast.success("Pages moved successfully.");
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

  // --- Page drag-and-drop (single page within same file only) ---
  function handlePageDragStart(
    e: React.DragEvent<HTMLDivElement>,
    fileId: number,
    pageNum: number,
  ) {
    draggedPage.current = { fileId, pageNum };
    e.dataTransfer.effectAllowed = "move";
  }

  function handlePageDragEnd() {
    draggedPage.current = null;
  }

  function handlePageDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  function handlePageDrop(
    e: React.DragEvent<HTMLDivElement>,
    targetFileId: number,
    targetPageNum: number,
  ) {
    e.preventDefault();
    const dragged = draggedPage.current;
    if (!dragged) return;
    // Only allow within the same file
    if (dragged.fileId !== targetFileId) return;
    if (dragged.pageNum === targetPageNum) return;

    pushUndo(filesDataRef.current);
    setFilesData((prev) =>
      prev.map((file) => {
        if (file.id !== targetFileId) return file;
        const newOrder = [...file.pageOrder];
        const newRotations = [...file.rotations];
        const newThumbnails = [...file.thumbnails];
        const fromIdx = newOrder.indexOf(dragged.pageNum);
        const toIdx = newOrder.indexOf(targetPageNum);
        if (fromIdx === -1 || toIdx === -1) return file;
        // Move the page
        const [removedPage] = newOrder.splice(fromIdx, 1);
        const [removedRot] = newRotations.splice(fromIdx, 1);
        const [removedThumb] = newThumbnails.splice(fromIdx, 1);
        newOrder.splice(toIdx, 0, removedPage);
        newRotations.splice(toIdx, 0, removedRot);
        newThumbnails.splice(toIdx, 0, removedThumb);
        return {
          ...file,
          pageOrder: newOrder,
          rotations: newRotations,
          thumbnails: newThumbnails,
        };
      }),
    );
    draggedPage.current = null;
  }

  const hasFiles = filesData.length > 0;
  const hasSelection = selectedPages.length > 0;
  const year = new Date().getFullYear();

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-background">
        <Toaster position="top-right" richColors />

        {/* Move Pages Dialog */}
        <MoveDialog
          open={isMoveDialogOpen}
          filesData={filesData}
          selectedPages={selectedPages}
          onClose={() => setIsMoveDialogOpen(false)}
          onMove={handleMovePages}
        />

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
          onMovePages={() => setIsMoveDialogOpen(true)}
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
