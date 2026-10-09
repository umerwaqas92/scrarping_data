import { useEffect, useState, useRef } from "react";
import {
  type ResumeItem,
  getResumePdfUrl,
  getResumeDownloadUrl,
  getResumeInfo,
} from "./api";

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
  const [fallbackInfo, setFallbackInfo] = useState<{ filename?: string; size?: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
      setLoading(true);
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
      getResumeInfo(activeId).then((info) => {
        if (info.exists) {
          setFallbackInfo({ filename: info.filename, size: info.size });
        }
      }).catch(() => {});
    }
  }, [open, activeId, currentResume]);

  // Keyboard navigation: Escape to close, Left/Right for prev/next
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && resumesList.length > 1 && currentIndex > 0) {
        setLoading(true);
        setActiveId(resumesList[currentIndex - 1].id);
      } else if (e.key === "ArrowRight" && resumesList.length > 1 && currentIndex < resumesList.length - 1) {
        setLoading(true);
        setActiveId(resumesList[currentIndex + 1].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, currentIndex, resumesList, onClose]);

  if (!open) return null;

  const pdfUrl = getResumePdfUrl(activeId);
  const downloadUrl = getResumeDownloadUrl(activeId);

  const handlePrev = () => {
    if (currentIndex > 0) {
      setLoading(true);
      setActiveId(resumesList[currentIndex - 1].id);
    }
  };

  const handleNext = () => {
    if (currentIndex < resumesList.length - 1) {
      setLoading(true);
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
    try {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.focus();
        iframeRef.current.contentWindow.print();
        return;
      }
    } catch {
      // Fallback
    }
    window.open(pdfUrl, "_blank");
  };

  const handleDelete = async () => {
    if (!onDelete || !activeId) return;
    const confirm = window.confirm(`Are you sure you want to delete "${currentFilename}"?`);
    if (!confirm) return;

    setIsDeleting(true);
    try {
      await onDelete(activeId);
      // If there are other resumes, switch to next or prev
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

  return (
    <div
      className="pdf-modal-overlay modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`pdf-modal-panel modal-panel ${
          isFullscreen ? "pdf-modal-panel-fullscreen" : ""
        }`}
      >
        {/* Header */}
        <div className="pdf-modal-header">
          <div className="pdf-modal-title-group">
            <div className="pdf-badge">PDF</div>
            <div className="pdf-modal-info">
              <div className="pdf-modal-filename" title={currentFilename}>
                {currentFilename}
              </div>
              <div className="pdf-modal-meta">
                {currentSize ? `${Math.round(currentSize / 1024)} KB` : "PDF Document"}
                {currentCreatedAt && ` · Uploaded ${new Date(currentCreatedAt).toLocaleDateString()}`}
                {selectedResumeId && activeId === selectedResumeId && (
                  <span className="pdf-selected-badge">✓ Currently Selected</span>
                )}
              </div>
            </div>
          </div>

          {/* Resumes Pager (if multiple) */}
          {resumesList.length > 1 && (
            <div className="pdf-modal-pager">
              <button
                type="button"
                className="pdf-pager-btn"
                onClick={handlePrev}
                disabled={currentIndex <= 0}
                title="Previous resume (Left Arrow)"
              >
                ◀
              </button>
              <span className="pdf-pager-label">
                {currentIndex + 1} of {resumesList.length}
              </span>
              <button
                type="button"
                className="pdf-pager-btn"
                onClick={handleNext}
                disabled={currentIndex >= resumesList.length - 1}
                title="Next resume (Right Arrow)"
              >
                ▶
              </button>
            </div>
          )}

          {/* Action Icons */}
          <div className="pdf-modal-actions">
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
              <span className="pdf-action-text">New Tab</span>
            </button>

            <button
              type="button"
              className="pdf-action-btn"
              onClick={handlePrint}
              title="Print PDF"
            >
              <span className="pdf-action-icon">🖨️</span>
              <span className="pdf-action-text">Print</span>
            </button>

            <button
              type="button"
              className="pdf-action-btn"
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
              >
                <span className="pdf-action-icon">🗑️</span>
              </button>
            )}

            <button
              type="button"
              className="modal-close-btn pdf-modal-close"
              onClick={onClose}
              title="Close Preview (Escape)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Viewer Body */}
        <div className="pdf-modal-body">
          {loading && (
            <div className="pdf-preview-loading">
              <div className="pdf-spinner" />
              <div className="pdf-loading-text">Loading PDF preview…</div>
            </div>
          )}

          <iframe
            ref={iframeRef}
            key={activeId || "default"}
            src={`${pdfUrl}#toolbar=1&navpanes=0`}
            title={`PDF Preview - ${currentFilename}`}
            className="pdf-preview-iframe"
            onLoad={() => setLoading(false)}
          />

          <noscript>
            <div className="pdf-fallback-container">
              <p>JavaScript is required to preview this PDF.</p>
              <a href={pdfUrl} target="_blank" rel="noreferrer" className="modal-btn-save">
                Open PDF
              </a>
            </div>
          </noscript>
        </div>

        {/* Footer */}
        <div className="pdf-modal-footer modal-footer">
          <div className="pdf-footer-left">
            <span className="pdf-footer-hint">
              💡 Tip: Use arrow keys (◀ / ▶) to flip between resumes, or Escape to close.
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
