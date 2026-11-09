import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast, toastError } from '../../lib/toast';
import { setUnsaved } from '../../lib/unsaved';
import SaveBar from '../../components/SaveBar';
import type { GooglePlace, GoogleReview, Review } from '../../types';

const EMPTY_PLACE: GooglePlace = {
  id: 1,
  place_id: '',
  show_on_site: true,
  rating: null,
  user_rating_count: null,
  maps_uri: '',
  last_synced_at: null,
  last_error: '',
};

// O último erro da sincronização não é público: vem da função google_sync_error(), só para o admin.
const PLACE_COLUMNS = 'id, place_id, show_on_site, rating, user_rating_count, maps_uri, last_synced_at';

/** Configuração do Google (linha única): Place ID e "mostrar no site". */
function useGooglePlace() {
  const [data, setData] = useState<GooglePlace>(EMPTY_PLACE);
  const [saved, setSaved] = useState<GooglePlace>(EMPTY_PLACE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const dirty =
    data.place_id !== saved.place_id ||
    data.show_on_site !== saved.show_on_site ||
    data.rating !== saved.rating ||
    data.user_rating_count !== saved.user_rating_count ||
    data.maps_uri !== saved.maps_uri;

  async function fetchPlace(): Promise<GooglePlace> {
    const [{ data: row, error }, { data: lastError }] = await Promise.all([
      supabase.from('google_place').select(PLACE_COLUMNS).eq('id', 1).maybeSingle(),
      supabase.rpc('google_sync_error'),
    ]);
    if (error) toastError('Erro ao carregar', error);
    return { ...EMPTY_PLACE, ...(row ?? {}), last_error: typeof lastError === 'string' ? lastError : '' };
  }

  async function reload() {
    const value = await fetchPlace();
    setData(value);
    setSaved(value);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setUnsaved('google_place', dirty);
  }, [dirty]);

  useEffect(() => () => setUnsaved('google_place', false), []);

  function update<K extends keyof GooglePlace>(key: K, value: GooglePlace[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    // Nota e total andam juntos: o site só mostra a nota com o total.
    if ((data.rating == null) !== (data.user_rating_count == null)) {
      toast('Preencha a nota e o total de avaliações juntos (ou deixe os dois vazios).', 'error');
      return false;
    }
    if (data.maps_uri && !/^https:\/\/[^\s"'<>]+$/.test(data.maps_uri)) {
      toast('O link da página no Google precisa começar com https://', 'error');
      return false;
    }
    // Sem link informado, usa a página da barbearia no Google Maps pelo Place ID.
    const next: GooglePlace = {
      ...data,
      maps_uri:
        data.maps_uri || (data.place_id ? `https://www.google.com/maps/place/?q=place_id:${data.place_id}` : ''),
    };
    setSaving(true);
    const { error } = await supabase
      .from('google_place')
      .update({
        place_id: next.place_id,
        show_on_site: next.show_on_site,
        rating: next.rating,
        user_rating_count: next.user_rating_count,
        maps_uri: next.maps_uri,
      })
      .eq('id', 1);
    setSaving(false);
    if (error) {
      toastError('Erro ao salvar', error);
      return false;
    }
    setData(next);
    setSaved(next);
    toast('Salvo. A nota já aparece no site.');
    return true;
  }

  return { data, loading, saving, dirty, update, save, reload };
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

type Filter = 'all' | 'published' | 'hidden';

export default function ReviewsSection() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const place = useGooglePlace();
  // A nota é digitada como texto ("4,9") e guardada como número (4.9).
  const [ratingDraft, setRatingDraft] = useState('');
  const [ratingError, setRatingError] = useState('');
  const savedRating = place.loading ? undefined : place.data.rating;
  useEffect(() => {
    if (savedRating === undefined) return;
    setRatingDraft(savedRating != null ? Number(savedRating).toFixed(1).replace('.', ',') : '');
    // Só ao carregar/recarregar do banco; enquanto digita, o rascunho manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.loading]);

  function changeRating(text: string) {
    const clean = text.replace(/[^0-9.,]/g, '');
    setRatingDraft(clean);
    if (clean === '') {
      setRatingError('');
      place.update('rating', null);
      return;
    }
    const value = Number(clean.replace(',', '.'));
    if (!Number.isFinite(value) || value < 1 || value > 5) {
      setRatingError('A nota vai de 1,0 a 5,0.');
      return;
    }
    setRatingError('');
    place.update('rating', Math.round(value * 10) / 10);
  }
  const [googleReviews, setGoogleReviews] = useState<GoogleReview[]>([]);
  const [syncing, setSyncing] = useState(false);

  async function loadReviews() {
    const { data, error } = await supabase.from('reviews').select('*').order('created_at', { ascending: false });
    if (error) toastError('Erro ao carregar avaliações', error);
    else setReviews((data ?? []) as Review[]);
    setLoading(false);
  }

  async function loadGoogleReviews() {
    const { data } = await supabase.from('google_reviews').select('*').order('publish_time', { ascending: false });
    setGoogleReviews((data ?? []) as GoogleReview[]);
  }

  useEffect(() => {
    loadReviews();
    loadGoogleReviews();

    // Novas avaliações aparecem aqui na hora, sem recarregar a página.
    const channel = supabase
      .channel('admin-reviews')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, () => loadReviews())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function setStatus(review: Review, status: Review['status']) {
    setBusyId(review.id);
    const { error } = await supabase.from('reviews').update({ status }).eq('id', review.id);
    setBusyId(null);
    if (error) return toastError('Erro ao atualizar', error);
    setReviews((prev) => prev.map((r) => (r.id === review.id ? { ...r, status } : r)));
    toast(status === 'published' ? 'Avaliação publicada.' : 'Avaliação ocultada do site.');
  }

  async function saveReply(review: Review) {
    const reply = (replyDrafts[review.id] ?? review.admin_reply).trim().slice(0, 1000);
    setBusyId(review.id);
    const { error } = await supabase.from('reviews').update({ admin_reply: reply }).eq('id', review.id);
    setBusyId(null);
    if (error) return toastError('Erro ao salvar resposta', error);
    setReviews((prev) => prev.map((r) => (r.id === review.id ? { ...r, admin_reply: reply } : r)));
    setReplyDrafts((prev) => {
      const next = { ...prev };
      delete next[review.id];
      return next;
    });
    toast(reply ? 'Resposta publicada.' : 'Resposta removida.');
  }

  async function removeReview(review: Review) {
    if (!confirm(`Excluir definitivamente a avaliação de ${review.author_name}?`)) return;
    setBusyId(review.id);
    const { error } = await supabase.from('reviews').delete().eq('id', review.id);
    setBusyId(null);
    if (error) return toastError('Erro ao excluir', error);
    setReviews((prev) => prev.filter((r) => r.id !== review.id));
    toast('Avaliação excluída.');
  }

  async function syncGoogle() {
    if (place.dirty) {
      toast('Salve o Place ID antes de sincronizar.', 'error');
      return;
    }
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke('sync-google-reviews', { body: {} });
    setSyncing(false);
    if (error) {
      let detail = error.message;
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) detail = body.error;
      } catch {
        /* resposta sem JSON */
      }
      toast(`Falha ao sincronizar: ${detail}`, 'error');
    } else {
      toast(`Google sincronizado: ${data?.synced ?? 0} avaliações.`);
    }
    await place.reload();
    loadGoogleReviews();
  }

  const visible = reviews.filter((r) => filter === 'all' || r.status === filter);
  const published = reviews.filter((r) => r.status === 'published');
  const average = published.length ? published.reduce((s, r) => s + r.rating, 0) / published.length : 0;

  if (loading || place.loading) return <p className="loading-text">Carregando...</p>;

  return (
    <section className="panel">
      <h2>Avaliações</h2>
      <p className="panel-sub">
        Avaliações feitas pelos clientes no site. Só quem tem conta pode avaliar, no máximo uma nova avaliação a
        cada 24 horas. Elas aparecem no site na hora; você pode ocultar, responder ou excluir.
      </p>

      <div className="stats-row">
        <div className="stat">
          <strong>{published.length ? average.toFixed(1).replace('.', ',') : '—'}</strong>
          <span>média no site</span>
        </div>
        <div className="stat">
          <strong>{published.length}</strong>
          <span>publicadas</span>
        </div>
        <div className="stat">
          <strong>{reviews.length - published.length}</strong>
          <span>ocultas</span>
        </div>
      </div>

      <div className="filter-row" role="tablist">
        {(['all', 'published', 'hidden'] as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            className={filter === f ? 'chip active' : 'chip'}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'Todas' : f === 'published' ? 'Publicadas' : 'Ocultas'}
          </button>
        ))}
      </div>

      {visible.length === 0 && <p className="panel-sub">Nenhuma avaliação aqui ainda.</p>}

      <div className="item-list">
        {visible.map((review) => {
          const draft = replyDrafts[review.id] ?? review.admin_reply;
          const busy = busyId === review.id;
          return (
            <div className={`item-card review-card${review.status === 'hidden' ? ' is-hidden' : ''}`} key={review.id}>
              <div className="review-head">
                {review.author_avatar_url ? (
                  <img className="review-avatar" src={review.author_avatar_url} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="review-avatar" aria-hidden="true">
                    {(review.author_name || '?').charAt(0)}
                  </span>
                )}
                <strong>{review.author_name}</strong>
                <span className="review-stars" aria-label={`${review.rating} de 5 estrelas`}>
                  {stars(review.rating)}
                </span>
                <span className="review-date">
                  {formatDate(review.created_at)}
                  {review.edited_at ? ' · editada' : ''}
                </span>
                {review.status === 'hidden' && <span className="unsaved-badge">Oculta</span>}
              </div>
              <p className="review-comment">{review.comment || <em>(sem comentário)</em>}</p>

              <label>
                Resposta da Tonsorium (aparece publicamente abaixo da avaliação)
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={draft}
                  onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [review.id]: e.target.value }))}
                />
              </label>

              <div className="item-actions">
                <button onClick={() => saveReply(review)} disabled={busy || draft === review.admin_reply}>
                  Salvar resposta
                </button>
                {review.status === 'published' ? (
                  <button className="btn-secondary" onClick={() => setStatus(review, 'hidden')} disabled={busy}>
                    Ocultar do site
                  </button>
                ) : (
                  <button className="btn-secondary" onClick={() => setStatus(review, 'published')} disabled={busy}>
                    Publicar
                  </button>
                )}
                <button className="btn-danger" onClick={() => removeReview(review)} disabled={busy}>
                  Excluir
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <hr className="panel-divider" />

      <h3 className="panel-subtitle">Avaliações do Google</h3>
      <p className="panel-sub" style={{ marginTop: -8 }}>
        O site mostra a nota da barbearia no Google, com o total de avaliações e um link para a página no Google.
        Preencha a nota e o total abaixo e atualize quando mudarem. Se um dia a sincronização automática for ativada,
        ela passa a atualizar esses números sozinha e também traz os comentários.
      </p>

      <label>
        Place ID da barbearia no Google
        <input
          value={place.data.place_id}
          onChange={(e) => place.update('place_id', e.target.value.trim().replace(/[^A-Za-z0-9_-]/g, ''))}
          placeholder="ChIJ..."
        />
      </label>
      <p className="panel-sub" style={{ marginTop: -8 }}>
        Encontre em{' '}
        <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noreferrer">
          Place ID Finder
        </a>{' '}
        pesquisando "Tonsorium Itapevi".
      </p>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={place.data.show_on_site}
          onChange={(e) => place.update('show_on_site', e.target.checked)}
        />
        Mostrar avaliações do Google no site
      </label>

      <div className="item-row">
        <label>
          Nota no Google
          <input
            value={ratingDraft}
            onChange={(e) => changeRating(e.target.value)}
            inputMode="decimal"
            placeholder="Ex: 5,0"
            maxLength={3}
          />
        </label>
        <label>
          Total de avaliações
          <input
            value={place.data.user_rating_count ?? ''}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
              place.update('user_rating_count', digits === '' ? null : Number(digits));
            }}
            inputMode="numeric"
            placeholder="Ex: 53"
          />
        </label>
      </div>
      {ratingError && <p className="error-text" style={{ marginTop: -8, marginBottom: 12 }}>{ratingError}</p>}
      <label>
        Link da página no Google (opcional)
        <input
          value={place.data.maps_uri}
          onChange={(e) => place.update('maps_uri', e.target.value.trim())}
          placeholder="Vazio = usa a página da barbearia no Google Maps"
        />
      </label>

      <SaveBar saving={place.saving} dirty={place.dirty} onSave={place.save} />

      <div className="google-status">
        <p>
          Nota no Google:{' '}
          <strong>
            {place.data.rating != null ? String(place.data.rating).replace('.', ',') : '—'} (
            {place.data.user_rating_count ?? 0} avaliações)
          </strong>
        </p>
        <p>Última sincronização: {formatDate(place.data.last_synced_at)}</p>
        {place.data.last_error && <p className="error-text">Último erro: {place.data.last_error}</p>}
        <button className="btn-secondary" onClick={syncGoogle} disabled={syncing || !place.data.place_id}>
          {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
        </button>
      </div>

      <div className="item-list" style={{ marginTop: 16 }}>
        {googleReviews.map((g) => (
          <div className="item-card review-card" key={g.id}>
            <div className="review-head">
              <span className="review-stars">{stars(g.rating)}</span>
              <strong>{g.author_name}</strong>
              <span className="review-date">{g.relative_time}</span>
            </div>
            <p className="review-comment">{g.text || <em>(sem comentário)</em>}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
