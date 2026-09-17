import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X, Check } from "lucide-react";

// Seleção múltipla com busca, tags e ações Todos/Limpar.
// props: options [{value,label}], selected [values], onChange(newSelected), placeholder
export default function MultiSelect({ options, selected, onChange, placeholder = "Selecionar..." }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(s) || String(o.value).toLowerCase().includes(s)
    );
  }, [options, q]);

  const toggle = (v) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const selectedOpts = options.filter((o) => selected.includes(o.value));

  return (
    <div className="ms" ref={ref}>
      <div className="ms-control" onClick={() => setOpen((o) => !o)}>
        {selectedOpts.length === 0 ? (
          <span className="ms-ph">{placeholder}</span>
        ) : (
          <div className="ms-tags">
            {selectedOpts.slice(0, 5).map((o) => (
              <span
                className="ms-tag"
                key={o.value}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(o.value);
                }}
              >
                {o.label} <X size={11} />
              </span>
            ))}
            {selectedOpts.length > 5 && <span className="ms-tag more">+{selectedOpts.length - 5}</span>}
          </div>
        )}
        <ChevronDown size={16} className="ms-caret" />
      </div>

      {open && (
        <div className="ms-menu">
          <div className="ms-search">
            <Search size={14} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar..."
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="ms-list">
            {filtered.length === 0 && <div className="ms-empty">nada encontrado</div>}
            {filtered.map((o) => {
              const on = selected.includes(o.value);
              return (
                <div
                  key={o.value}
                  className={"ms-opt" + (on ? " on" : "")}
                  onClick={() => toggle(o.value)}
                >
                  <span className="ms-check">{on && <Check size={13} />}</span>
                  <span className="ms-label">{o.label}</span>
                </div>
              );
            })}
          </div>
          <div className="ms-foot">
            <button type="button" onClick={() => onChange(options.map((o) => o.value))}>
              Todos
            </button>
            <button type="button" onClick={() => onChange([])}>
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
