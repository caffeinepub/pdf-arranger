import type { PDFDocument, degrees } from "pdf-lib";

interface PDFJSDoc {
  numPages: number;
  getPage: (pageNum: number) => Promise<PDFJSPage>;
}

interface PDFJSPage {
  getViewport: (options: { scale: number; rotation?: number }) => PDFJSViewport;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PDFJSViewport;
  }) => { promise: Promise<void> };
}

interface PDFJSViewport {
  width: number;
  height: number;
}

interface PDFJSLib {
  getDocument: (src: { data: Uint8Array }) => { promise: Promise<PDFJSDoc> };
  GlobalWorkerOptions: {
    workerSrc: string;
  };
}

interface PDFLibStatic {
  PDFDocument: typeof PDFDocument;
  degrees: typeof degrees;
}

declare global {
  interface Window {
    pdfjsLib: PDFJSLib;
    PDFLib: PDFLibStatic;
  }
}
