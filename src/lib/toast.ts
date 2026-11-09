// Avisos rápidos ("Salvo", "Erro ao salvar") mostrados no canto da tela.
// Qualquer parte do painel chama toast(); o <Toaster /> do App exibe.

export type ToastKind = 'ok' | 'error';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l(items));
}

export function toast(message: string, kind: ToastKind = 'ok') {
  const id = nextId++;
  items = [...items, { id, kind, message }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, kind === 'error' ? 6000 : 2500);
}

export function toastError(prefix: string, error: unknown) {
  const detail =
    error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : '';
  toast(detail ? `${prefix} (${detail})` : prefix, 'error');
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}
