import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast, toastError } from '../../lib/toast';
import { setUnsaved } from '../../lib/unsaved';
import SaveBar from '../../components/SaveBar';
import { WEEKDAY_LABELS, type BusinessHour } from '../../types';

/** O banco devolve "09:00:00"; o campo de hora e o site usam "09:00". */
const hhmm = (t: string) => (t || '').slice(0, 5);

export default function HoursSection() {
  const [items, setItems] = useState<BusinessHour[]>([]);
  const [saved, setSaved] = useState<BusinessHour[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(items) !== JSON.stringify(saved);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('business_hours')
        .select('*')
        .order('day_of_week', { ascending: true });
      if (error) toastError('Erro ao carregar horários', error);
      const rows = ((data ?? []) as BusinessHour[]).map((d) => ({
        ...d,
        open_time: hhmm(d.open_time),
        close_time: hhmm(d.close_time),
      }));
      setItems(rows);
      setSaved(rows);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    setUnsaved('business_hours', dirty);
  }, [dirty]);

  useEffect(() => () => setUnsaved('business_hours', false), []);

  function updateDay(id: string, patch: Partial<BusinessHour>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function handleSaveAll() {
    const invalid = items.find((d) => !d.is_closed && (!d.open_time || !d.close_time || d.open_time >= d.close_time));
    if (invalid) {
      toast(`${WEEKDAY_LABELS[invalid.day_of_week]}: o horário de fechar precisa ser depois do de abrir.`, 'error');
      return;
    }

    setSaving(true);
    const results = await Promise.all(
      items.map((item) =>
        supabase
          .from('business_hours')
          .update({ is_closed: item.is_closed, open_time: item.open_time, close_time: item.close_time })
          .eq('id', item.id)
      )
    );
    setSaving(false);

    const failed = results.find((r) => r.error);
    if (failed) {
      toastError('Erro ao salvar horários', failed.error);
      return;
    }
    setSaved(items);
    toast('Horários salvos.');
  }

  if (loading) return <p className="loading-text">Carregando...</p>;

  return (
    <section className="panel">
      <h2>Horário de atendimento</h2>
      <p className="panel-sub">
        Defina o horário de cada dia da semana, ou marque como fechado. O site usa esses horários para mostrar
        "Aberto agora".
      </p>

      {items.length === 0 && (
        <p className="error-text">Nenhum dia cadastrado. Rode o arquivo supabase/schema.sql no Supabase.</p>
      )}

      <div className="item-list">
        {items.map((day) => (
          <div className="item-card" key={day.id}>
            <div className="item-row">
              <label style={{ flex: 2 }}>
                Dia
                <input value={WEEKDAY_LABELS[day.day_of_week]} readOnly disabled />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={day.is_closed}
                  onChange={(e) => updateDay(day.id, { is_closed: e.target.checked })}
                />
                Fechado nesse dia
              </label>
            </div>

            {!day.is_closed && (
              <div className="item-row">
                <label>
                  Abre às
                  <input
                    type="time"
                    value={day.open_time}
                    onChange={(e) => updateDay(day.id, { open_time: e.target.value })}
                  />
                </label>
                <label>
                  Fecha às
                  <input
                    type="time"
                    value={day.close_time}
                    onChange={(e) => updateDay(day.id, { close_time: e.target.value })}
                  />
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <SaveBar saving={saving} dirty={dirty} onSave={handleSaveAll} label="Salvar horários" />
      </div>
    </section>
  );
}
