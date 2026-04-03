import DropZone from "@/components/DropZone";
import FileCard from "@/components/FileCard";
import MoveDialog from "@/components/MoveDialog";
import Toolbar from "@/components/Toolbar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileText, Heart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Virtual page source — used for duplicated pages and cross-file moved pages
export interface VirtualPageSource {
  sourceFileId: number;
  originalPageNum: number;
}

export interface FileData {
  id: number;
  file: File;
  pageCount: number;
  pageOrder: number[];
  rotations: number[];
  removePages: number[];
  thumbnails: (string | null)[];
  // Maps virtual page numbers (> pageCount or cross-file) to their real origin.
  // Pages NOT in this map are native pages of this file (pageNum = PDF 1-based index).
  virtualPageMap: Record<number, VirtualPageSource>;
}

export interface SelectedPage {
  id: number;
  pageNum: number;
}

type ThumbSize = "sm" | "md" | "lg";

// Global counter for unique virtual page IDs across all files
let virtualPageCounter = 100000;
function nextVirtualPageId(): number {
  return ++virtualPageCounter;
}

// Registry of all File objects ever added, keyed by FileData id.
// Used during merge to resolve virtual pages from removed source files.
const sourceFileRegistry = new Map<number, File>();

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

  // Ref that tracks whether the Move dialog is open (used in the mousedown handler
  // to avoid clearing selection when the user clicks inside the Radix portal).
  const isMoveDialogOpenRef = useRef(false);
  isMoveDialogOpenRef.current = isMoveDialogOpen;

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
        virtualPageMap: { ...f.virtualPageMap },
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
      // Never deselect while the Move dialog is open — selection must stay intact
      if (isMoveDialogOpenRef.current) return;

      const target = e.target as HTMLElement;
      if (
        !target.closest("[data-ocid^='page.']") &&
        !target.closest("[data-ocid^='toolbar.']") &&
        !target.closest("[data-ocid^='file.item']") &&
        !target.closest("[role='dialog']") &&
        !target.closest("[data-radix-popper-content-wrapper]") &&
        !target.closest("[data-radix-select-viewport]") &&
        !target.closest("[role='listbox']") &&
        !target.closest("[role='option']") &&
        !target.closest("[data-radix-collection-item]")
      ) {
        setSelectedPages([]);
      }
    }
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /**
   * Resolve the real (sourceFileId, originalPageNum) for any page slot in a file.
   * Native pages resolve to themselves; virtual pages look up the map.
   */
  function resolvePageOrigin(
    file: FileData,
    pageNum: number,
  ): { sourceFileId: number; originalPageNum: number } {
    const mapped = file.virtualPageMap[pageNum];
    if (mapped) return mapped;
    // Native page — belongs to this file
    return { sourceFileId: file.id, originalPageNum: pageNum };
  }

  async function renderAllThumbnails(fileData: FileData) {
    const promises = fileData.pageOrder.map(async (pageNum, posIdx) => {
      try {
        // Resolve the real source to render from
        const origin = resolvePageOrigin(fileData, pageNum);
        const sourceFile = filesDataRef.current.find(
          (f) => f.id === origin.sourceFileId,
        );
        // For initial load, source file is the same file being loaded
        const fileToRender = sourceFile?.file ?? fileData.file;
        const dataUrl = await renderPageThumbnail(
          fileToRender,
          origin.originalPageNum,
          fileData.rotations[posIdx] || 0,
        );
        setFilesData((prev) =>
          prev.map((f) => {
            if (f.id !== fileData.id) return f;
            const newThumbs = [...f.thumbnails];
            const currentIdx = f.pageOrder.indexOf(pageNum);
            if (currentIdx !== -1) newThumbs[currentIdx] = dataUrl;
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
          virtualPageMap: {},
        };
        // Register in the source file registry so it can be looked up during
        // merge even if the FileData entry is later removed from filesData.
        sourceFileRegistry.set(entry.id, file);
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
          const origin = resolvePageOrigin(file, pageNum);
          const sourceFile = filesDataRef.current.find(
            (f) => f.id === origin.sourceFileId,
          );
          renderPageThumbnail(
            sourceFile?.file ?? file.file,
            origin.originalPageNum,
            rot,
          ).then((dataUrl) => {
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
        const origin = resolvePageOrigin(file, pageNum);
        const sourceFile = filesDataRef.current.find(
          (f) => f.id === origin.sourceFileId,
        );
        renderPageThumbnail(
          sourceFile?.file ?? file.file,
          origin.originalPageNum,
          newRotations[posIdx],
        ).then((dataUrl) => {
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
        // Assign a globally unique virtual page ID
        const newPageNum = nextVirtualPageId();
        // The duplicated page renders from the same real source as the original
        const origin = resolvePageOrigin(file, pageNum);
        const newVirtualPageMap = {
          ...file.virtualPageMap,
          [newPageNum]: origin,
        };
        newPageOrder.splice(posIdx + 1, 0, newPageNum);
        newRotations.splice(posIdx + 1, 0, newRotations[posIdx] || 0);
        newThumbnails.splice(posIdx + 1, 0, newThumbnails[posIdx] || null);
        return {
          ...file,
          pageOrder: newPageOrder,
          rotations: newRotations,
          thumbnails: newThumbnails,
          virtualPageMap: newVirtualPageMap,
        };
      }),
    );
    toast.success("Page duplicated.");
  }

  /**
   * Move selected pages to a specific position within a target file.
   * targetPosition: 0 = beginning, N = after the Nth active (non-removed) page.
   *
   * Cross-file determination is per-source: a page moving from file S to target T
   * is cross-file if S.id !== T.id, regardless of whether other sources equal T.
   * This avoids ID collisions when pages from multiple sources land in the same target.
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

    interface PageEntry {
      // The virtual page ID to use in the TARGET file's pageOrder
      // For same-file moves this stays the same; for cross-file it's a new ID.
      targetPageNum: number;
      rotation: number;
      thumbnail: string | null;
      // The resolved real origin for virtualPageMap population
      origin: VirtualPageSource;
      // Whether this entry needs a virtualPageMap entry in the target
      isCrossFile: boolean;
    }

    function extractPages(
      file: FileData,
      movingSet: Set<number>,
      crossFile: boolean,
    ): PageEntry[] {
      const entries: PageEntry[] = [];
      for (let i = 0; i < file.pageOrder.length; i++) {
        const pn = file.pageOrder[i];
        if (movingSet.has(pn)) {
          const origin = resolvePageOrigin(file, pn);
          entries.push({
            // For cross-file moves, give a fresh unique ID to avoid collisions
            targetPageNum: crossFile ? nextVirtualPageId() : pn,
            rotation: file.rotations[i] ?? 0,
            thumbnail: file.thumbnails[i] ?? null,
            origin,
            isCrossFile: crossFile,
          });
        }
      }
      return entries;
    }

    // Collect all pages to insert — cross-file is determined per source file
    const pagesToInsert: PageEntry[] = [];
    for (const file of current) {
      const movingSet = bySourceFile.get(file.id);
      if (!movingSet || movingSet.size === 0) continue;
      // A page is cross-file if its source file is different from the target file
      const isThisSourceCrossFile = file.id !== targetFileId;
      pagesToInsert.push(
        ...extractPages(file, movingSet, isThisSourceCrossFile),
      );
    }

    if (pagesToInsert.length === 0) return;

    // Build updated files
    const updatedFiles = current.map((file) => {
      const movingSet = bySourceFile.get(file.id);
      const isTarget = file.id === targetFileId;
      const isSource = movingSet && movingSet.size > 0;

      if (!isTarget && !isSource) return file;

      if (isTarget && isSource) {
        // This file is both a source and the target.
        // Same-file pages (from this file's movingSet) keep their IDs.
        // Cross-file pages (from other sources) have already been assigned new IDs in pagesToInsert.
        const sameFileMovingSet = movingSet!;

        // Build arrays without the same-file moving pages
        const remainOrder: number[] = [];
        const remainRot: number[] = [];
        const remainThumb: (string | null)[] = [];
        const newVirtualPageMap = { ...file.virtualPageMap };
        for (let i = 0; i < file.pageOrder.length; i++) {
          if (!sameFileMovingSet.has(file.pageOrder[i])) {
            remainOrder.push(file.pageOrder[i]);
            remainRot.push(file.rotations[i] ?? 0);
            remainThumb.push(file.thumbnails[i] ?? null);
          }
        }
        // Map targetPosition (index into active non-removed remain pages) to remainOrder index
        const activeRemain = remainOrder.filter(
          (p) => !file.removePages.includes(p),
        );
        const insertAfterActive =
          targetPosition > 0 ? activeRemain[targetPosition - 1] : null;
        let insertIdx: number;
        if (insertAfterActive == null) {
          insertIdx = 0;
        } else {
          insertIdx = remainOrder.lastIndexOf(insertAfterActive) + 1;
        }
        insertIdx = Math.min(insertIdx, remainOrder.length);

        // Register cross-file entries in virtualPageMap
        for (const entry of pagesToInsert) {
          if (entry.isCrossFile) {
            newVirtualPageMap[entry.targetPageNum] = entry.origin;
          }
        }

        remainOrder.splice(
          insertIdx,
          0,
          ...pagesToInsert.map((e) => e.targetPageNum),
        );
        remainRot.splice(insertIdx, 0, ...pagesToInsert.map((e) => e.rotation));
        remainThumb.splice(
          insertIdx,
          0,
          ...pagesToInsert.map((e) => e.thumbnail),
        );

        return {
          ...file,
          pageOrder: remainOrder,
          rotations: remainRot,
          thumbnails: remainThumb,
          virtualPageMap: newVirtualPageMap,
        };
      }

      if (isTarget && !isSource) {
        // Pure cross-file target: insert incoming pages with new virtual IDs
        const newOrder = [...file.pageOrder];
        const newRot = [...file.rotations];
        const newThumb = [...file.thumbnails];
        const newVirtualPageMap = { ...file.virtualPageMap };

        // Register each incoming cross-file page in the virtualPageMap
        for (const entry of pagesToInsert) {
          if (entry.isCrossFile) {
            newVirtualPageMap[entry.targetPageNum] = entry.origin;
          }
        }

        // Map targetPosition to insertion index
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

        newOrder.splice(
          insertIdx,
          0,
          ...pagesToInsert.map((e) => e.targetPageNum),
        );
        newRot.splice(insertIdx, 0, ...pagesToInsert.map((e) => e.rotation));
        newThumb.splice(insertIdx, 0, ...pagesToInsert.map((e) => e.thumbnail));

        return {
          ...file,
          pageOrder: newOrder,
          rotations: newRot,
          thumbnails: newThumb,
          virtualPageMap: newVirtualPageMap,
        };
      }

      // Source only (not target): remove the moving pages and clean up virtualPageMap
      const newOrder: number[] = [];
      const newRot: number[] = [];
      const newThumb: (string | null)[] = [];
      const newVirtualPageMap = { ...file.virtualPageMap };
      for (let i = 0; i < file.pageOrder.length; i++) {
        const pn = file.pageOrder[i];
        if (!movingSet!.has(pn)) {
          newOrder.push(pn);
          newRot.push(file.rotations[i] ?? 0);
          newThumb.push(file.thumbnails[i] ?? null);
        } else {
          // Clean up virtual map entry if present
          delete newVirtualPageMap[pn];
        }
      }
      return {
        ...file,
        pageOrder: newOrder,
        rotations: newRot,
        thumbnails: newThumb,
        virtualPageMap: newVirtualPageMap,
      };
    });

    setFilesData(updatedFiles);
    setSelectedPages([]);
    setIsMoveDialogOpen(false);
    toast.success("Pages moved successfully.");
  }

  async function handleInsertBlankPage(fileId: number, afterPageNum: number) {
    pushUndo(filesData);

    // Create a blank A4 PDF using pdf-lib
    const blankDoc = await window.PDFLib.PDFDocument.create();
    blankDoc.addPage([595.28, 841.89]); // A4 dimensions in points
    const blankBytes = await blankDoc.save();
    const blankFile = new File([blankBytes], `blank-page-${Date.now()}.pdf`, {
      type: "application/pdf",
    });

    // Register in sourceFileRegistry with a unique numeric ID
    const blankFileId = Math.floor(Date.now() + Math.random() * 1000);
    sourceFileRegistry.set(blankFileId, blankFile);

    // Assign a virtual page ID
    const blankPageNum = nextVirtualPageId();

    // Render thumbnail for the blank page
    let blankThumbnail: string | null = null;
    try {
      blankThumbnail = await renderPageThumbnail(blankFile, 1, 0);
    } catch {
      blankThumbnail = null;
    }

    setFilesData((prev) =>
      prev.map((file) => {
        if (file.id !== fileId) return file;
        const posIdx = file.pageOrder.indexOf(afterPageNum);
        if (posIdx === -1) return file;

        const newPageOrder = [...file.pageOrder];
        const newRotations = [...file.rotations];
        const newThumbnails = [...file.thumbnails];
        const newVirtualPageMap = {
          ...file.virtualPageMap,
          [blankPageNum]: { sourceFileId: blankFileId, originalPageNum: 1 },
        };

        newPageOrder.splice(posIdx + 1, 0, blankPageNum);
        newRotations.splice(posIdx + 1, 0, 0);
        newThumbnails.splice(posIdx + 1, 0, blankThumbnail);

        return {
          ...file,
          pageOrder: newPageOrder,
          rotations: newRotations,
          thumbnails: newThumbnails,
          virtualPageMap: newVirtualPageMap,
        };
      }),
    );

    toast.success("Blank A4 page inserted.");
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

      // Pre-load all PDF documents keyed by fileId
      const pdfCache = new Map<
        number,
        ReturnType<typeof window.PDFLib.PDFDocument.load> extends Promise<
          infer T
        >
          ? T
          : never
      >();
      for (const fileData of filesData) {
        const bytes = await fileData.file.arrayBuffer();
        const pdf = await window.PDFLib.PDFDocument.load(bytes);
        pdfCache.set(fileData.id, pdf);
      }

      // Also load any source files referenced by virtualPageMap entries that
      // aren't currently in filesData (e.g. source file card was removed after
      // a cross-file move). The sourceFileRegistry retains the File object.
      const allSourceFileIds = new Set<number>();
      for (const fileData of filesData) {
        for (const src of Object.values(fileData.virtualPageMap)) {
          allSourceFileIds.add(src.sourceFileId);
        }
      }
      for (const srcId of allSourceFileIds) {
        if (!pdfCache.has(srcId)) {
          const srcFile = sourceFileRegistry.get(srcId);
          if (srcFile) {
            const bytes = await srcFile.arrayBuffer();
            const pdf = await window.PDFLib.PDFDocument.load(bytes);
            pdfCache.set(srcId, pdf);
          }
        }
      }

      setMergeProgress(30);

      for (const fileData of filesData) {
        const keptPages = fileData.pageOrder.filter(
          (p) => !fileData.removePages.includes(p),
        );

        for (let i = 0; i < keptPages.length; i++) {
          const pageNum = keptPages[i];
          const posIdx = fileData.pageOrder.indexOf(pageNum);
          const rotation = posIdx !== -1 ? fileData.rotations[posIdx] || 0 : 0;

          // Resolve the real source
          const origin = resolvePageOrigin(fileData, pageNum);
          const sourcePdf = pdfCache.get(origin.sourceFileId);
          if (!sourcePdf) continue;

          const realPageIdx = Math.min(
            origin.originalPageNum - 1,
            sourcePdf.getPageCount() - 1,
          );
          const [copiedPage] = await merged.copyPages(sourcePdf, [realPageIdx]);
          copiedPage.setRotation(window.PDFLib.degrees(rotation));
          merged.addPage(copiedPage);
        }
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
          selectedCount={selectedPages.length}
          onInsertBlankPage={() => {
            if (selectedPages.length === 1) {
              handleInsertBlankPage(
                selectedPages[0].id,
                selectedPages[0].pageNum,
              );
            }
          }}
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
                      onInsertBlankPage={handleInsertBlankPage}
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
