import { useEffect, useState } from 'react';
import { subscribeToasts, type ToastItem } from '../lib/toast';

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
