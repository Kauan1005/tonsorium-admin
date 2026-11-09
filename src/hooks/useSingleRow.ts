import { useEffect, useState } from 'react';
import { supabase, removeAssetByUrl } from '../lib/supabaseClient';
import { toast, toastError } from '../lib/toast';
import { setUnsaved } from '../lib/unsaved';

/**
 * Abas de "linha única" (Início, Conceito, Localização, Logo & Contato):
 * carrega a linha id = 1, controla alterações não salvas e grava com aviso.
 *
 * @param fileFields colunas que guardam URL de arquivo do storage
 */
export function useSingleRow<T extends { id: number }>(
  table: string,
  empty: T,
  fileFields: readonly (keyof T)[] = []
) {
  const [data, setData] = useState<T>(empty);
  const [saved, setSaved] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(data) !== JSON.stringify(saved);

  async function fetchRow() {
    const { data: row, error } = await supabase.from(table).select('*').eq('id', 1).maybeSingle();
    if (error) toastError('Erro ao carregar', error);
    return { ...empty, ...(row ?? {}) } as T;
  }

  useEffect(() => {
    let cancelled = false;
    fetchRow().then((value) => {
      if (cancelled) return;
      setData(value);
      setSaved(value);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  /** Recarrega do banco (descarta edições locais). */
  async function reload() {
    const value = await fetchRow();
    setData(value);
    setSaved(value);
  }

  useEffect(() => {
    setUnsaved(table, dirty);
  }, [table, dirty]);

  useEffect(() => () => setUnsaved(table, false), [table]);

  function update<K extends keyof T>(key: K, value: T[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  async function cleanupReplacedFiles(before: T, after: T) {
    for (const f of fileFields) {
      if (before[f] !== after[f]) await removeAssetByUrl(before[f] as unknown as string);
    }
  }

  async function save() {
    setSaving(true);
    const payload: Record<string, unknown> = { ...data, id: 1 };
    if ('updated_at' in payload) payload.updated_at = new Date().toISOString();
    const { error } = await supabase.from(table).upsert(payload);
    setSaving(false);
    if (error) {
      toastError('Erro ao salvar', error);
      return false;
    }
    await cleanupReplacedFiles(saved, data);
    setSaved(data);
    toast('Salvo com sucesso.');
    return true;
  }

  /** Grava alguns campos na hora (ex: arquivo recém-enviado). */
  async function saveFields(patch: Partial<T>) {
    const { error } = await supabase.from(table).update(patch as Record<string, unknown>).eq('id', 1);
    if (error) {
      toastError('Erro ao salvar', error);
      return false;
    }
    const before = saved;
    const after = { ...saved, ...patch };
    setData((prev) => ({ ...prev, ...patch }));
    setSaved(after);
    await cleanupReplacedFiles(before, after);
    toast('Salvo com sucesso.');
    return true;
  }

  return { data, loading, saving, dirty, update, save, saveFields, reload };
}
