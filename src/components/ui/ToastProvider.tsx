"use client";

import {
  CSSProperties,
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev, { id, message, type }].slice(-3));
      window.setTimeout(() => removeToast(id), 10000);
    },
    [removeToast]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div style={containerStyle}>
        {toasts.length > 0 ? (
          <>
            <div style={overlayStyle} />
            <div style={stackStyle}>
              {toasts.map((toast) => (
                <div
                  key={toast.id}
                  style={{
                    ...toastStyle,
                    background:
                      toast.type === "error"
                        ? "#dc2626"
                        : toast.type === "success"
                        ? "#16a34a"
                        : "#0b5fff",
                    color: "#ffffff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontSize: 14 }}>{toast.message}</div>
                    <button
                      onClick={() => removeToast(toast.id)}
                      style={closeBtnStyle}
                      aria-label="Dong thong bao"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast phai duoc dung trong ToastProvider");
  }
  return ctx;
}

const containerStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  padding: 16,
  zIndex: 9999,
  pointerEvents: "none",
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.35)",
};

const stackStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  width: "min(420px, 92vw)",
  pointerEvents: "auto",
};

const toastStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.35)",
  borderRadius: 10,
  padding: "10px 12px",
  boxShadow: "0 20px 45px rgba(15,23,42,0.35)",
};

const closeBtnStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: 1,
  color: "#ffffff",
};
