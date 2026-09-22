import React from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import Modal from "./Modal.jsx";

/**
 * Diálogo de confirmação (ex.: exclusão).
 * Props:
 *  - open, onClose
 *  - title (default "Confirmar exclusão")
 *  - message: texto/node explicando o que será feito
 *  - confirmLabel (default "Excluir")
 *  - onConfirm: () => void | Promise
 *  - busy: mostra spinner e trava os botões
 *  - danger (default true): botão de confirmação em vermelho
 */
export default function ConfirmDialog({
  open, onClose, title = "Confirmar exclusão", message,
  confirmLabel = "Excluir", onConfirm, busy = false, danger = true,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={AlertTriangle}
      size="sm"
      busy={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className={"btn " + (danger ? "danger" : "primary")} onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spinner" /> : <Trash2 size={14} />} {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 14, lineHeight: 1.55 }}>{message}</div>
    </Modal>
  );
}
