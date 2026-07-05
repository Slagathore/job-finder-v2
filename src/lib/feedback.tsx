import React, { useEffect, useRef, useState } from 'react';

// Module-level toast + modal store. No context needed — components anywhere can
// call toast()/confirmDialog()/promptDialog() and the single <FeedbackHost/>
// mounted in App.tsx renders the result.

type ToastKind = 'info' | 'success' | 'error';
interface ToastItem { id: number; message: string; kind: ToastKind; }

const MAX_TOASTS = 4;
const TOAST_MS = 4000;

let toasts: ToastItem[] = [];
let toastSeq = 0;
let toastListeners: Array<(items: ToastItem[]) => void> = [];

function emitToasts() { toastListeners.forEach(l => l(toasts)); }

export function toast(message: string, kind: ToastKind = 'info'): void {
  const id = ++toastSeq;
  toasts = [...toasts, { id, message, kind }];
  if (toasts.length > MAX_TOASTS) toasts = toasts.slice(toasts.length - MAX_TOASTS);
  emitToasts();
  setTimeout(() => dismissToast(id), TOAST_MS);
}

function dismissToast(id: number) {
  toasts = toasts.filter(t => t.id !== id);
  emitToasts();
}

type ModalState =
  | { id: number; kind: 'confirm'; title?: string; message: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { id: number; kind: 'prompt'; title?: string; message?: string; placeholder?: string; initial?: string; resolve: (v: string | null) => void };

let modalQueue: ModalState[] = [];
let modalSeq = 0;
let modalListeners: Array<(m: ModalState | null) => void> = [];

function emitModal() { modalListeners.forEach(l => l(modalQueue[0] ?? null)); }

function settleCurrent(value: any) {
  const [current, ...rest] = modalQueue;
  modalQueue = rest;
  emitModal();
  if (current) (current.resolve as (v: any) => void)(value);
}

export function confirmDialog(opts: { title?: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => {
    modalQueue = [...modalQueue, { id: ++modalSeq, kind: 'confirm', resolve, ...opts }];
    emitModal();
  });
}

export function promptDialog(opts: { title?: string; message?: string; placeholder?: string; initial?: string }): Promise<string | null> {
  return new Promise(resolve => {
    modalQueue = [...modalQueue, { id: ++modalSeq, kind: 'prompt', resolve, ...opts }];
    emitModal();
  });
}

function ToastStack({ items }: { items: ToastItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="toast-stack" aria-live="polite" role="status">
      {items.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function ConfirmModal({ m }: { m: Extract<ModalState, { kind: 'confirm' }> }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { confirmRef.current?.focus(); }, [m.id]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); settleCurrent(false); }
      else if (e.key === 'Enter') { e.preventDefault(); settleCurrent(true); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [m.id]);
  return (
    <div className="fh-overlay" onMouseDown={e => { if (e.target === e.currentTarget) settleCurrent(false); }}>
      <div className="fh-modal" role="alertdialog" aria-modal="true" aria-label={m.title || 'Confirm'}>
        {m.title && <h2 className="fh-title">{m.title}</h2>}
        <p className="fh-message">{m.message}</p>
        <div className="fh-actions">
          <button className="link" onClick={() => settleCurrent(false)}>Cancel</button>
          <button ref={confirmRef} className={m.danger ? 'primary danger' : 'primary'} onClick={() => settleCurrent(true)}>
            {m.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptModal({ m }: { m: Extract<ModalState, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(m.initial ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setValue(m.initial ?? ''); inputRef.current?.focus(); inputRef.current?.select(); }, [m.id]);
  // Escape must close even when focus has left the input (e.g. after tabbing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); settleCurrent(null); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [m.id]);
  function submit() { settleCurrent(value); }
  function cancel() { settleCurrent(null); }
  return (
    <div className="fh-overlay" onMouseDown={e => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="fh-modal" role="dialog" aria-modal="true" aria-label={m.title || 'Input'}>
        {m.title && <h2 className="fh-title">{m.title}</h2>}
        {m.message && <p className="fh-message">{m.message}</p>}
        <input
          ref={inputRef}
          value={value}
          placeholder={m.placeholder}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            else if (e.key === 'Enter') { e.preventDefault(); submit(); }
          }}
        />
        <div className="fh-actions">
          <button className="link" onClick={cancel}>Cancel</button>
          <button className="primary" onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}

export function FeedbackHost(): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>(toasts);
  const [modal, setModal] = useState<ModalState | null>(modalQueue[0] ?? null);

  useEffect(() => {
    toastListeners.push(setItems);
    modalListeners.push(setModal);
    return () => {
      toastListeners = toastListeners.filter(l => l !== setItems);
      modalListeners = modalListeners.filter(l => l !== setModal);
    };
  }, []);

  return (
    <>
      <ToastStack items={items} />
      {modal?.kind === 'confirm' && <ConfirmModal m={modal} />}
      {modal?.kind === 'prompt' && <PromptModal m={modal} />}
    </>
  );
}
