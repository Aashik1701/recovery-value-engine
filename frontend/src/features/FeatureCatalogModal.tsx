import { useEffect } from "react";
import { Link } from "react-router-dom";
import { CrossIcon, ExternalLinkIcon, InfoIcon } from "../components/icons";
import { FeatureCatalog } from "./FeatureCatalog";

interface FeatureCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FeatureCatalogModal({ isOpen, onClose }: FeatureCatalogModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    // Prevent background scrolling while modal is active
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      style={{
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(8px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Features and Architecture Guide"
    >
      <div
        className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{
          background: "var(--color-bg)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Control Header */}
        <div
          className="px-6 py-3 border-b flex items-center justify-between gap-4 shrink-0"
          style={{
            background: "var(--app-nav-bg)",
            borderColor: "var(--color-border)",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold text-xs">
              <InfoIcon size={13} />
            </span>
            <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              System Feature Catalog & Architecture Guide
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/features"
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg border text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors no-underline flex items-center gap-1.5"
              style={{ borderColor: "var(--color-border)" }}
              title="Open this guide as a dedicated page"
            >
              <span>Full Page View</span>
              <ExternalLinkIcon size={11} />
            </Link>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-medium opacity-70 hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              title="Close (Esc)"
              aria-label="Close modal"
            >
              <CrossIcon size={13} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <FeatureCatalog onClose={onClose} isModal={true} />
        </div>
      </div>
    </div>
  );
}
