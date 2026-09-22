import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Modal reutilizável.
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - title: string | node
 *  - icon: componente lucide (opcional) exibido ao lado do título
 *  - children: corpo (rolável)
 *  - footer: node com os botões de ação
 *  - size: "sm" | "md" | "lg" (largura máxima)
 *  - busy: desabilita o fechar por backdrop/Esc enquanto processa
 */
export default function Modal({ open, onClose, title, icon: Icon, children, footer, size = "md", busy = false }) {
  const cardRef = useRef(null);

  // Fecha no Esc e trava o scroll do body enquanto aberto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose?.(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // foco no diálogo (acessibilidade)
    setTimeout(() => cardRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose?.(); }}>
      <div
        className={"modal modal-" + size}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={cardRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-hd">
          <h3>{Icon && <Icon size={16} />} {title}</h3>
          <button className="modal-x" onClick={() => !busy && onClose?.()} aria-label="fechar"><X size={18} /></button>
        </div>
        <div className="modal-bd">{children}</div>
        {footer && <div className="modal-ft">{footer}</div>}
      </div>
    </div>
  );
}
