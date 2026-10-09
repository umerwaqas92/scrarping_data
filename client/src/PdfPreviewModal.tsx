import { useEffect, useState, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  type ResumeItem,
  getResumePdfUrl,
  getResumeDownloadUrl,
  getResumeInfo,
} from "./api";

// Configure PDF.js worker
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

export interface PdfPreviewModalProps {
  open: boolean;
  onClose: () => void;
  resumeId?: string;
  resumesList?: ResumeItem[];
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => Promise<void> | void;
  selectedResumeId?: string;
}

export default function PdfPreviewModal({
  open,
  onClose,
  resumeId,
  resumesList = [],
  onSelect,
  onDelete,
  selectedResumeId,
}: PdfPreviewModalProps) {
  const [activeId, setActiveId] = useState<string | undefined>(resumeId);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [fallbackInfo, setFallbackInfo] = useState<{ filename?: string; size?: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [numPages, setNumPages] = useState<number>(0);
  const [zoomScale, setZoomScale] = useState<number>(1.0);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any[]>([]);

  // Sync activeId when resumeId or open changes
  useEffect(() => {
    if (open) {
      if (resumeId) {
        setActiveId(resumeId);
      } else if (resumesList.length > 0) {
        setActiveId(resumesList[0].id);
      } else {
        setActiveId(undefined);
      }
      setZoomScale(1.0);
    }
  }, [open, resumeId, resumesList]);

  // Current resume item from the list or fallback
  const currentIndex = resumesList.findIndex((r) => r.id === activeId);
  const currentResume: ResumeItem | undefined =
    currentIndex >= 0
      ? resumesList[currentIndex]
      : resumesList.length > 0
      ? resumesList[0]
      : undefined;

  const currentFilename = currentResume?.filename || fallbackInfo?.filename || "Resume.pdf";
  const currentSize = currentResume?.size || fallbackInfo?.size;
  const currentCreatedAt = currentResume?.created_at;

  // Load fallback info if resume list is empty
  useEffect(() => {
    if (open && !currentResume) {
      getResumeInfo(activeId)
        .then((info) => {
          if (info.exists) {
            setFallbackInfo({ filename: info.filename, size: info.size });
          }
        })
        .catch(() => {});
    }
  }, [open, activeId, currentResume]);

  // Keyboard navigation: Escape to close, Left/Right for prev/next
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && resumesList.length > 1 && currentIndex > 0) {
        setActiveId(resumesList[currentIndex - 1].id);
      } else if (e.key === "ArrowRight" && resumesList.length > 1 && currentIndex < resumesList.length - 1) {
        setActiveId(resumesList[currentIndex + 1].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, currentIndex, resumesList, onClose]);

  const pdfUrl = getResumePdfUrl(activeId);
  const downloadUrl = getResumeDownloadUrl(activeId);

  // Render PDF using PDF.js onto HTML5 Canvases (Works 100% on Android Chrome, iOS, and Desktops)
  const renderPdfPages = useCallback(async () => {
    if (!open || !canvasContainerRef.current) return;
    setLoading(true);
    setLoadingError(null);

    // Cancel any previous in-flight render tasks
    renderTaskRef.current.forEach((t) => {
      try {
        t.cancel();
      } catch {}
    });
    renderTaskRef.current = [];

    const container = canvasContainerRef.current;
    container.innerHTML = "";

    try {
      // Fetch and load PDF document
      const loadingTask = pdfjsLib.getDocument({
        url: pdfUrl,
        cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/cmaps/",
        cMapPacked: true,
      });

      const pdfDoc = await loadingTask.promise;
      setNumPages(pdfDoc.numPages);

      // Determine optimal display width based on container width
      const containerWidth = container.clientWidth || window.innerWidth || 600;
      const isMobile = window.innerWidth <= 640;
      const padding = isMobile ? 16 : 40;
      const targetWidth = Math.min(containerWidth - padding, 800) * zoomScale;

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = (targetWidth / unscaledViewport.width) * (window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale });

        // Page wrapper
        const pageWrapper = document.createElement("div");
        pageWrapper.className = "pdf-page-wrapper";

        // Canvas for page rendering
        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page-canvas";
        const ctx = canvas.getContext("2d");

        if (!ctx) continue;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${Math.round(viewport.width / (window.devicePixelRatio || 1))}px`;
        canvas.style.height = `${Math.round(viewport.height / (window.devicePixelRatio || 1))}px`;

        pageWrapper.appendChild(canvas);

        // Page number indicator for multi-page documents
        if (pdfDoc.numPages > 1) {
          const pageBadge = document.createElement("div");
          pageBadge.className = "pdf-page-indicator";
          pageBadge.textContent = `Page ${pageNum} of ${pdfDoc.numPages}`;
          pageWrapper.appendChild(pageBadge);
        }

        container.appendChild(pageWrapper);

        const renderContext = {
          canvasContext: ctx,
          viewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current.push(renderTask);
        await renderTask.promise;
      }

      setLoading(false);
    } catch (err: any) {
      if (err?.name === "RenderingCancelledException") return;
      console.error("PDF Render Error:", err);
      setLoadingError(err instanceof Error ? err.message : "Failed to load PDF preview");
      setLoading(false);
    }
  }, [open, pdfUrl, zoomScale]);

  useEffect(() => {
    if (open) {
      // Small timeout to allow modal animation / container dimensions to settle
      const timer = setTimeout(() => {
        renderPdfPages();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, activeId, zoomScale, renderPdfPages]);

  if (!open) return null;

  const handlePrev = () => {
    if (currentIndex > 0) {
      setActiveId(resumesList[currentIndex - 1].id);
    }
  };

  const handleNext = () => {
    if (currentIndex < resumesList.length - 1) {
      setActiveId(resumesList[currentIndex + 1].id);
    }
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = currentFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleOpenNewTab = () => {
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  };

  const handlePrint = () => {
    window.open(pdfUrl, "_blank");
  };

  const handleDelete = async () => {
    if (!onDelete || !activeId) return;
    const confirm = window.confirm(`Are you sure you want to delete "${currentFilename}"?`);
    if (!confirm) return;

    setIsDeleting(true);
    try {
      await onDelete(activeId);
      if (resumesList.length > 1) {
        const nextIdx = currentIndex > 0 ? currentIndex - 1 : 1;
        setActiveId(resumesList[nextIdx]?.id);
      } else {
        onClose();
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSelectThis = () => {
    if (onSelect && activeId) {
      onSelect(activeId);
      onClose();
    }
  };

  const handleZoomIn = () => {
    setZoomScale((prev) => Math.min(prev + 0.2, 2.4));
  };

  const handleZoomOut = () => {
    setZoomScale((prev) => Math.max(prev - 0.2, 0.6));
  };

  const handleZoomReset = () => {
    setZoomScale(1.0);
  };

  return (
    <div
      className="pdf-modal-overlay modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        className={`pdf-modal-panel modal-panel ${
          isFullscreen ? "pdf-modal-panel-fullscreen" : ""
        }`}
      >
        {/* Header */}
        <div className="pdf-modal-header">
          {/* Top Row: Title + Close Button */}
          <div className="pdf-modal-header-top">
            <div className="pdf-modal-title-group">
              <div className="pdf-badge">PDF</div>
              <div className="pdf-modal-info">
                <div className="pdf-modal-filename" title={currentFilename}>
                  {currentFilename}
                </div>
                <div className="pdf-modal-meta">
                  {currentSize ? `${Math.round(currentSize / 1024)} KB` : "PDF Document"}
                  {currentCreatedAt && ` · ${new Date(currentCreatedAt).toLocaleDateString()}`}
                  {numPages > 0 && ` · ${numPages} page${numPages > 1 ? "s" : ""}`}
                  {selectedResumeId && activeId === selectedResumeId && (
                    <span className="pdf-selected-badge">✓ Selected</span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="modal-close-btn pdf-modal-close"
              onClick={onClose}
              title="Close Preview (Escape)"
              aria-label="Close Preview"
            >
              ✕
            </button>
          </div>

          {/* Sub Row: Pager Toolbar & Actions */}
          <div className="pdf-modal-header-toolbar">
            {/* Resumes Pager (if multiple resumes) */}
            {resumesList.length > 1 ? (
              <div className="pdf-modal-pager">
                <button
                  type="button"
                  className="pdf-pager-btn"
                  onClick={handlePrev}
                  disabled={currentIndex <= 0}
                  title="Previous resume (Left Arrow)"
                  aria-label="Previous resume"
                >
                  ◀
                </button>
                <span className="pdf-pager-label">
                  {currentIndex + 1} / {resumesList.length}
                </span>
                <button
                  type="button"
                  className="pdf-pager-btn"
                  onClick={handleNext}
                  disabled={currentIndex >= resumesList.length - 1}
                  title="Next resume (Right Arrow)"
                  aria-label="Next resume"
                >
                  ▶
                </button>
              </div>
            ) : (
              <div className="pdf-modal-spacer" />
            )}

            {/* Zoom Controls & Action Icons */}
            <div className="pdf-modal-actions">
              <div className="pdf-zoom-group">
                <button
                  type="button"
                  className="pdf-action-btn pdf-action-btn-zoom"
                  onClick={handleZoomOut}
                  disabled={zoomScale <= 0.6}
                  title="Zoom Out"
                  aria-label="Zoom Out"
                >
                  <span>−</span>
                </button>
                <button
                  type="button"
                  className="pdf-action-btn pdf-action-btn-zoom-val"
                  onClick={handleZoomReset}
                  title="Reset Zoom (100%)"
                >
                  <span>{Math.round(zoomScale * 100)}%</span>
                </button>
                <button
                  type="button"
                  className="pdf-action-btn pdf-action-btn-zoom"
                  onClick={handleZoomIn}
                  disabled={zoomScale >= 2.4}
                  title="Zoom In"
                  aria-label="Zoom In"
                >
                  <span>+</span>
                </button>
              </div>

              <button
                type="button"
                className="pdf-action-btn"
                onClick={handleDownload}
                title="Download PDF file"
              >
                <span className="pdf-action-icon">⬇️</span>
                <span className="pdf-action-text">Download</span>
              </button>

              <button
                type="button"
                className="pdf-action-btn"
                onClick={handleOpenNewTab}
                title="Open in new browser tab"
              >
                <span className="pdf-action-icon">↗️</span>
                <span className="pdf-action-text">Open Tab</span>
              </button>

              <button
                type="button"
                className="pdf-action-btn pdf-action-btn-desktop"
                onClick={handlePrint}
                title="Print PDF"
              >
                <span className="pdf-action-icon">🖨️</span>
                <span className="pdf-action-text">Print</span>
              </button>

              <button
                type="button"
                className="pdf-action-btn pdf-action-btn-desktop"
                onClick={() => setIsFullscreen(!isFullscreen)}
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              >
                <span className="pdf-action-icon">{isFullscreen ? "🗗" : "⛶"}</span>
              </button>

              {onDelete && (
                <button
                  type="button"
                  className="pdf-action-btn pdf-action-btn-danger"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  title="Delete this resume"
                  aria-label="Delete this resume"
                >
                  <span className="pdf-action-icon">🗑️</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Viewer Body with Native Canvas Pages */}
        <div className="pdf-modal-body">
          {loading && (
            <div className="pdf-preview-loading">
              <div className="pdf-spinner" />
              <div className="pdf-loading-text">Rendering PDF preview…</div>
            </div>
          )}

          {loadingError && !loading && (
            <div className="pdf-fallback-container">
              <div className="pdf-fallback-icon">⚠️</div>
              <p className="pdf-fallback-title">Unable to render inline preview</p>
              <p className="pdf-fallback-subtitle">{loadingError}</p>
              <div className="pdf-fallback-actions">
                <a href={pdfUrl} target="_blank" rel="noreferrer" className="modal-btn-save">
                  ↗️ Open in New Tab
                </a>
                <a href={downloadUrl} download={currentFilename} className="modal-btn-cancel">
                  ⬇️ Download PDF
                </a>
              </div>
            </div>
          )}

          {/* PDF Pages Container */}
          <div
            ref={canvasContainerRef}
            className={`pdf-canvas-container ${loading ? "is-loading" : ""}`}
          />
        </div>

        {/* Footer */}
        <div className="pdf-modal-footer modal-footer">
          <div className="pdf-footer-left">
            <span className="pdf-footer-hint">
              💡 Tip: Use arrow keys (◀ / ▶) to flip resumes, or Escape to close.
            </span>
          </div>

          <div className="pdf-footer-right">
            {onSelect && (
              <button
                type="button"
                className="modal-btn-save pdf-select-btn"
                onClick={handleSelectThis}
              >
                ✓ Use this Resume
              </button>
            )}
            <button type="button" className="modal-btn-cancel" onClick={onClose}>
              Close Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
