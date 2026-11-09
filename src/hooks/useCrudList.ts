import { useEffect, useState } from 'react';
import { supabase, removeAssetByUrl } from '../lib/supabaseClient';
import { toast, toastError } from '../lib/toast';
import { setUnsaved } from '../lib/unsaved';

export interface ListItem {
  id: string;
  position: number;
}

/**
 * Tudo que as abas de lista (serviços, equipe, galeria...) têm em comum:
 * carregar, editar localmente, salvar com aviso de erro/sucesso, adicionar,
 * remover (apagando as fotos do storage) e reordenar.
 *
 * @param fields     colunas gravadas pelo botão "Salvar"
 * @param fileFields colunas que guardam URL de arquivo do storage
 */
export function useCrudList<T extends ListItem>(
  table: string,
  fields: readonly (keyof T)[],
  fileFields: readonly (keyof T)[] = []
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from(table).select('*').order('position', { ascending: true });
      if (cancelled) return;
      if (error) setLoadError(error.message);
      else setItems((data ?? []) as T[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [table]);

  useEffect(() => {
    setUnsaved(table, dirtyIds.size > 0);
  }, [table, dirtyIds]);

  useEffect(() => () => setUnsaved(table, false), [table]);

  function markDirty(id: string, dirty: boolean) {
    setDirtyIds((prev) => {
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function update(id: string, patch: Partial<T>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    markDirty(id, true);
  }

  async function save(item: T) {
    const payload: Record<string, unknown> = {};
    for (const f of fields) payload[f as string] = item[f];

    setSavingId(item.id);
    const { error } = await supabase.from(table).update(payload).eq('id', item.id);
    setSavingId(null);

    if (error) {
      toastError('Erro ao salvar', error);
      return false;
    }
    markDirty(item.id, false);
    toast('Salvo com sucesso.');
    return true;
  }

  /** Grava alguns campos na hora (ex: foto recém-enviada), sem depender do botão Salvar. */
  async function saveFields(id: string, patch: Partial<T>) {
    const previous = items.find((it) => it.id === id);
    const { error } = await supabase.from(table).update(patch as Record<string, unknown>).eq('id', id);
    if (error) {
      toastError('Erro ao salvar', error);
      return false;
    }
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    if (previous) {
      for (const f of fileFields) {
        if (f in patch && previous[f] !== patch[f]) await removeAssetByUrl(previous[f] as unknown as string);
      }
    }
    toast('Salvo com sucesso.');
    return true;
  }

  async function add(defaults: Partial<T>) {
    const position = items.reduce((max, it) => Math.max(max, it.position), 0) + 1;
    const { data, error } = await supabase
      .from(table)
      .insert({ ...defaults, position })
      .select()
      .single();
    if (error || !data) {
      toastError('Erro ao adicionar', error);
      return;
    }
    setItems((prev) => [...prev, data as T]);
  }

  async function remove(item: T, question: string) {
    if (!confirm(question)) return;
    const { error } = await supabase.from(table).delete().eq('id', item.id);
    if (error) {
      toastError('Erro ao remover', error);
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== item.id));
    markDirty(item.id, false);
    for (const f of fileFields) await removeAssetByUrl(item[f] as unknown as string);
    toast('Removido.');
  }

  async function move(id: string, direction: -1 | 1) {
    const index = items.findIndex((it) => it.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;

    const reordered = [...items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const renumbered = reordered.map((it, i) => ({ ...it, position: i + 1 }));
    const changed = renumbered.filter((it) => items.find((o) => o.id === it.id)?.position !== it.position);

    setItems(renumbered);
    const results = await Promise.all(
      changed.map((it) => supabase.from(table).update({ position: it.position }).eq('id', it.id))
    );
    const failed = results.find((r) => r.error);
    if (failed) toastError('Erro ao reordenar', failed.error);
  }

  return { items, loading, loadError, savingId, dirtyIds, update, save, saveFields, add, remove, move };
}
