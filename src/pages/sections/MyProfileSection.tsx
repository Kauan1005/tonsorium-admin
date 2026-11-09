import { useEffect, useState } from 'react';
import { removeAssetByUrl, supabase } from '../../lib/supabaseClient';
import { toast, toastError } from '../../lib/toast';
import { setUnsaved } from '../../lib/unsaved';
import MediaUpload from '../../components/MediaUpload';
import SaveBar from '../../components/SaveBar';
import type { Barber } from '../../types';

type Editable = Pick<Barber, 'role' | 'bio' | 'quote'>;

/**
 * Perfil do barbeiro na aba Equipe do site. Ele muda só a foto, a
 * especialidade, a descrição e a frase; nome, visibilidade e ordem no
 * site ficam com o admin (o banco garante isso, não só esta tela).
 */
export default function MyProfileSection({ barberId }: { barberId: string | null }) {
  const [barber, setBarber] = useState<Barber | null>(null);
  const [form, setForm] = useState<Editable>({ role: '', bio: '', quote: '' });
  const [saved, setSaved] = useState<Editable>({ role: '', bio: '', quote: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => {
    if (!barberId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('barbers').select('*').eq('id', barberId).maybeSingle();
      if (cancelled) return;
      if (error) toastError('Erro ao carregar seu perfil', error);
      if (data) {
        const row = data as Barber;
        const editable = { role: row.role ?? '', bio: row.bio ?? '', quote: row.quote ?? '' };
        setBarber(row);
        setForm(editable);
        setSaved(editable);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [barberId]);

  useEffect(() => {
    setUnsaved('my_profile', dirty);
  }, [dirty]);

  useEffect(() => () => setUnsaved('my_profile', false), []);

  async function save() {
    if (!barberId) return;
    setSaving(true);
    const { data, error } = await supabase.from('barbers').update(form).eq('id', barberId).select('id');
    setSaving(false);
    if (error || !data?.length) {
      toastError('Erro ao salvar', error ?? { message: 'sem permissão' });
      return;
    }
    setSaved(form);
    toast('Perfil salvo. Já aparece no site.');
  }

  async function savePhoto(url: string) {
    if (!barberId || !barber) return;
    const { data, error } = await supabase.from('barbers').update({ photo_url: url }).eq('id', barberId).select('id');
    if (error || !data?.length) {
      toastError('Erro ao salvar a foto', error ?? { message: 'sem permissão' });
      await removeAssetByUrl(url);
      return;
    }
    const previous = barber.photo_url;
    setBarber({ ...barber, photo_url: url });
    if (previous && previous !== url) await removeAssetByUrl(previous);
    toast('Foto atualizada no site.');
  }

  if (loading) return <p className="loading-text">Carregando...</p>;

  if (!barberId || !barber) {
    return (
      <section className="panel">
        <h2>Meu perfil</h2>
        <p className="panel-sub">Sua conta ainda não está ligada a um barbeiro da Equipe. Fale com o admin.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Meu perfil</h2>
      <p className="panel-sub">
        É assim que você aparece na seção Equipe do site. Use uma foto na vertical (em pé), com o rosto bem iluminado.
      </p>

      <div className="item-card">
        <div className="profile-head">
          {barber.photo_url ? (
            <img src={barber.photo_url} alt={barber.name} className="barber-preview" />
          ) : (
            <div className="barber-preview barber-initials" aria-hidden="true">
              {barber.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <p className="profile-name">{barber.name}</p>
            <p className="field-hint">
              {barber.active ? 'Aparece no site.' : 'Oculto no site no momento.'} O nome e a visibilidade são
              definidos pelo admin.
            </p>
          </div>
        </div>

        <MediaUpload prefix={`barbers/${barber.id}/photo`} minWidth={800} onUploaded={(url) => savePhoto(url)} />

        <label>
          Especialidade
          <input
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            placeholder="Ex: Platinado e mechas · Visagismo"
            maxLength={80}
          />
        </label>
        <label>
          Descrição
          <textarea
            rows={3}
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            placeholder="Ex: 8 anos de barbearia, especialista em degradê e desenhos à mão livre."
            maxLength={300}
          />
        </label>
        <label>
          Frase de efeito (opcional)
          <input
            value={form.quote}
            onChange={(e) => setForm({ ...form, quote: e.target.value })}
            placeholder="Ex: Cada corte conta uma história."
            maxLength={160}
          />
        </label>

        <SaveBar saving={saving} dirty={dirty} onSave={save} />
      </div>
    </section>
  );
}
