import { useState, useEffect, useCallback, useRef } from "react";

export interface ToastItem {
  id: number;
  message: string;
  variant: "info" | "success" | "error";
}

let nextId = 1;
const listeners = new Set<(toasts: ToastItem[]) => void>();
let currentToasts: ToastItem[] = [];

function emit() {
  for (const fn of listeners) fn(currentToasts);
}

export function showToast(message: string, variant: ToastItem["variant"] = "info", duration = 2800) {
  const item: ToastItem = { id: nextId++, message, variant };
  currentToasts = [...currentToasts, item];
  emit();
  if (duration > 0) {
    setTimeout(() => {
      currentToasts = currentToasts.filter((t) => t.id !== item.id);
      emit();
    }, duration);
  }
}

export function dismissToast(id: number) {
  currentToasts = currentToasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>(currentToasts);
  useEffect(() => {
    listeners.add(setToasts);
    return () => { listeners.delete(setToasts); };
  }, []);
  return toasts;
}

const variantIcon: Record<ToastItem["variant"], string> = {
  info: "i",
  success: "\u2713",
  error: "!",
};

export default function ToastContainer() {
  const toasts = useToasts();
  const containerRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((id: number) => dismissToast(id), []);

  if (toasts.length === 0) return null;

  return (
    <div ref={containerRef} className="toast-container" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-item toast-${toast.variant}`}
          role="alert"
          onClick={() => dismiss(toast.id)}
        >
          <span className="toast-icon" aria-hidden="true">{variantIcon[toast.variant]}</span>
          <span className="toast-message">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}