import type { ReactNode } from "react";
import "./driver-sheet-label.css";

export function DriverSheetLabel({ children = "Hoja del chofer" }: { children?: ReactNode }) {
  return (
    <span className="driver-sheet-label">
      <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 13h8M8 17h8" />
      </svg>
      {children}
    </span>
  );
}
