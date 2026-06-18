import { type FC, useEffect, useId, useRef, useState } from "react";

interface Props {
  open: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  confirmText: string;
  cancelText: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

/**
 * 应用内命名输入模态：替代 window.prompt，遵循主题 token，含焦点恢复与滚动锁定。
 * 打开时聚焦输入框并选中默认值，Esc 取消，Enter 确认。
 */
const PromptModal: FC<Props> = ({ open, title, label, defaultValue = "", confirmText, cancelText, onConfirm, onClose }) => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const inputId = useId();

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement;
      setValue(defaultValue);
      document.body.style.overflow = "hidden";
      const id = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => {
        clearTimeout(id);
        document.body.style.overflow = "";
        triggerRef.current?.focus();
      };
    }
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = () => {
    const v = value.trim();
    if (v) onConfirm(v);
  };

  return (
    <div className="prompt-modal-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={onClose}>
      <div className="prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-modal-title" id={titleId}>{title}</div>
        <label htmlFor={inputId} className="prompt-modal-label">{label}</label>
        <input
          ref={inputRef}
          id={inputId}
          className="prompt-modal-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        />
        <div className="prompt-modal-actions">
          <button className="prompt-modal-btn prompt-modal-btn-cancel" onClick={onClose}>{cancelText}</button>
          <button className="prompt-modal-btn prompt-modal-btn-confirm" onClick={submit} disabled={!value.trim()}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
};

export default PromptModal;
