import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast, toastError } from '../../lib/toast';
import {
  addDays,
  durationLabel,
  hhmmToMinutes,
  minutesFromDayStart,
  minutesToHhmm,
  shortDate,
  spParts,
  spToDate,
  todaySp,
  weekdayOf,
} from '../../lib/agendaTime';
import { WEEKDAY_LABELS, type Appointment, type BusinessHour, type StaffContext } from '../../types';

interface BarberLite {
  id: string;
  name: string;
  active: boolean;
}

/** Horário sendo criado/editado na janela. */
interface Draft {
  id?: string;
  barberId: string;
  ymd: string;
  /** Minutos desde 00:00 do dia (09:30 = 570). */
  start: number;
  duration: number;
  client_name: string;
  service: string;
  notes: string;
}

interface Positioned {
  a: Appointment;
  start: number;
  end: number;
}

/** Tamanho de cada horário da grade — o mesmo do agendamento no site. */
const STEP = 30;
const DURATIONS = [30, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600];
/** Horários de início que dá para escolher na janela: 06:00 até 23:30. */
const START_TIMES = Array.from({ length: (24 * 60 - 6 * 60) / STEP }, (_, i) => 6 * 60 + i * STEP);

const dayLabel = (ymd: string) => `${WEEKDAY_LABELS[weekdayOf(ymd)]}, ${shortDate(ymd)}`;

function timeRange(a: Appointment) {
  const s = spParts(new Date(a.starts_at));
  const e = spParts(new Date(a.ends_at));
  return `${minutesToHhmm(s.minutes)}–${minutesToHhmm(e.minutes)}`;
}

function agendaError(error: { code?: string; message: string }) {
  if (error.code === '23P01') return 'Esse horário se sobrepõe a outro já marcado para este barbeiro.';
  if (error.code === '42501' || /row-level security/i.test(error.message)) return 'Sem permissão para alterar esta agenda.';
  if (error.code === '23514') return 'Horário inválido: confira o início e a duração.';
  return `Não foi possível salvar (${error.message}).`;
}

export default function AgendaSection({ staff }: { staff: StaffContext }) {
  const isAdmin = staff.role === 'admin';
  const [barbers, setBarbers] = useState<BarberLite[]>([]);
  const [view, setView] = useState<string>(isAdmin ? 'all' : staff.barberId ?? '');
  const [day, setDay] = useState(todaySp);
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [items, setItems] = useState<Appointment[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingDay, setLoadingDay] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => spParts(new Date()));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const loadId = useRef(0);

  // Barbeiros, horário de atendimento e nomes dos serviços (sugestões).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [h, classics, specials, visagism] = await Promise.all([
        supabase.from('business_hours').select('*').order('day_of_week'),
        supabase.from('services_classic').select('title').eq('active', true).order('position'),
        supabase.from('services_special').select('title').eq('active', true).order('position'),
        supabase.from('site_visagism').select('service_name').eq('id', 1).maybeSingle(),
      ]);
      let list: BarberLite[] = [];
      if (isAdmin) {
        const { data, error } = await supabase.from('barbers').select('id, name, active').order('position');
        if (error) toastError('Erro ao carregar barbeiros', error);
        list = (data ?? []) as BarberLite[];
      } else if (staff.barberId) {
        list = [{ id: staff.barberId, name: staff.barberName || 'Você', active: true }];
      }
      if (cancelled) return;
      if (h.error) toastError('Erro ao carregar o horário de atendimento', h.error);
      setHours((h.data ?? []) as BusinessHour[]);
      const names = [...(classics.data ?? []), ...(specials.data ?? [])].map((r) => String(r.title ?? '').trim());
      const visagismName = String(visagism.data?.service_name ?? '').trim();
      if (visagismName) names.push(visagismName);
      setServices([...new Set(names.filter(Boolean))]);
      setBarbers(list);
      setLoadingBase(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, staff.barberId, staff.barberName]);

  const loadDay = useCallback(async () => {
    const id = ++loadId.current;
    if (!view) {
      setItems([]);
      setLoadingDay(false);
      return;
    }
    setLoadingDay(true);
    const start = spToDate(day, 0).toISOString();
    const end = spToDate(addDays(day, 1), 0).toISOString();
    let query = supabase.from('appointments').select('*').lt('starts_at', end).gt('ends_at', start).order('starts_at');
    if (view !== 'all') query = query.eq('barber_id', view);
    const { data, error } = await query;
    if (id !== loadId.current) return;
    if (error) toastError('Erro ao carregar a agenda', error);
    setItems((data ?? []) as Appointment[]);
    setLoadingDay(false);
  }, [day, view]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  // Volta para a aba do navegador = agenda atualizada (outro barbeiro/admin pode ter mexido).
  useEffect(() => {
    const onFocus = () => {
      setNow(spParts(new Date()));
      loadDay();
    };
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => setNow(spParts(new Date())), 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [loadDay]);

  // Abre/fecha a janela de edição junto com o rascunho.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (draft && !dialog.open) dialog.showModal();
    else if (!draft && dialog.open) dialog.close();
  }, [draft]);

  const weekday = weekdayOf(day);
  const dayHours = hours.find((h) => h.day_of_week === weekday);
  const open = dayHours && !dayHours.is_closed ? hhmmToMinutes(dayHours.open_time) : null;
  const close = dayHours && !dayHours.is_closed ? hhmmToMinutes(dayHours.close_time) : null;

  const slots = useMemo(() => {
    if (open == null || close == null) return [];
    const list: number[] = [];
    for (let m = open; m + STEP <= close; m += STEP) list.push(m);
    return list;
  }, [open, close]);

  const positioned = useMemo<Positioned[]>(
    () =>
      items.map((a) => ({
        a,
        start: minutesFromDayStart(a.starts_at, day),
        end: minutesFromDayStart(a.ends_at, day),
      })),
    [items, day]
  );

  const columns = useMemo(() => {
    if (view === 'all') return barbers.filter((b) => b.active || items.some((a) => a.barber_id === b.id));
    const chosen = barbers.find((b) => b.id === view);
    return chosen ? [chosen] : [];
  }, [view, barbers, items]);

  const overlaps = (p: Positioned, slot: number) => p.start < slot + STEP && p.end > slot;
  const outside = positioned.filter((p) => !slots.some((s) => overlaps(p, s)));
  const isPast = (slot: number) => day < now.ymd || (day === now.ymd && slot + STEP <= now.minutes);
  const barberName = (id: string) => barbers.find((b) => b.id === id)?.name ?? '';

  function openNew(barberId: string, start: number) {
    setDraft({ barberId, ymd: day, start, duration: STEP, client_name: '', service: '', notes: '' });
  }

  function openEdit(a: Appointment) {
    const start = spParts(new Date(a.starts_at));
    const duration = Math.max(1, Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60_000));
    setDraft({
      id: a.id,
      barberId: a.barber_id,
      ymd: start.ymd,
      start: start.minutes,
      duration,
      client_name: a.client_name,
      service: a.service,
      notes: a.notes,
    });
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (draft.start + draft.duration > 24 * 60) {
      toast('Esse horário passa da meia-noite. Diminua a duração.', 'error');
      return;
    }
    setSaving(true);
    const payload = {
      barber_id: draft.barberId,
      starts_at: spToDate(draft.ymd, draft.start).toISOString(),
      ends_at: spToDate(draft.ymd, draft.start + draft.duration).toISOString(),
      client_name: draft.client_name.trim(),
      service: draft.service.trim(),
      notes: draft.notes.trim(),
    };
    const result = draft.id
      ? await supabase.from('appointments').update(payload).eq('id', draft.id).select('id')
      : await supabase.from('appointments').insert(payload).select('id');
    setSaving(false);
    if (result.error) {
      toast(agendaError(result.error), 'error');
      return;
    }
    if (!result.data?.length) {
      toast('Sem permissão para alterar este horário.', 'error');
      return;
    }
    toast(draft.id ? 'Horário atualizado.' : 'Horário marcado como ocupado.');
    setDraft(null);
    loadDay();
  }

  async function remove() {
    if (!draft?.id) return;
    if (!confirm('Liberar este horário? Os dados do cliente deste horário serão apagados.')) return;
    setSaving(true);
    const { data, error } = await supabase.from('appointments').delete().eq('id', draft.id).select('id');
    setSaving(false);
    if (error || !data?.length) {
      toast(error ? agendaError(error) : 'Sem permissão para liberar este horário.', 'error');
      return;
    }
    toast('Horário liberado.');
    setDraft(null);
    loadDay();
  }

  /** Folga: marca como ocupados todos os horários ainda livres do dia. */
  async function blockDay() {
    const barber = columns[0];
    if (!barber || !slots.length) return;
    const free = slots.filter((s) => !positioned.some((p) => p.a.barber_id === barber.id && overlaps(p, s)));
    if (!free.length) {
      toast('Não há horários livres neste dia.');
      return;
    }
    if (!confirm(`Marcar os ${free.length} horários livres de ${dayLabel(day)} como ocupados (folga) para ${barber.name}?`)) return;
    const ranges: [number, number][] = [];
    for (const s of free) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] === s) last[1] = s + STEP;
      else ranges.push([s, s + STEP]);
    }
    const rows = ranges.map(([from, to]) => ({
      barber_id: barber.id,
      starts_at: spToDate(day, from).toISOString(),
      ends_at: spToDate(day, to).toISOString(),
      client_name: '',
      service: 'Folga',
      notes: '',
    }));
    const { error } = await supabase.from('appointments').insert(rows);
    if (error) {
      toast(agendaError(error), 'error');
      return;
    }
    toast('Dia bloqueado.');
    loadDay();
  }

  if (!isAdmin && !staff.barberId) {
    return (
      <section className="panel">
        <h2>Minha agenda</h2>
        <p className="panel-sub">
          Sua conta ainda não está ligada a um barbeiro da Equipe. Fale com o admin da barbearia.
        </p>
      </section>
    );
  }

  const startOptions = draft && !START_TIMES.includes(draft.start) ? [...START_TIMES, draft.start].sort((a, b) => a - b) : START_TIMES;
  const durationOptions =
    draft && !DURATIONS.includes(draft.duration) ? [...DURATIONS, draft.duration].sort((a, b) => a - b) : DURATIONS;
  const isAll = view === 'all';

  return (
    <section className="panel">
      <h2>{isAdmin ? 'Agenda' : 'Minha agenda'}</h2>
      <p className="panel-sub">
        Toque em um horário <strong>livre</strong> para marcar um cliente ou bloquear (folga, almoço). No site, quem
        for agendar vê esse horário como <strong>ocupado</strong>, sem nome nem detalhes. Os dados do cliente ficam
        visíveis só para {isAdmin ? 'o barbeiro e para você' : 'você e o admin'}.
      </p>

      <div className="agenda-toolbar">
        {isAdmin && (
          <label className="agenda-barber">
            Barbeiro
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="all">Todos os barbeiros</option>
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.active ? '' : ' (oculto no site)'}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="agenda-daynav" role="group" aria-label="Escolher o dia">
          <button type="button" className="btn-icon" onClick={() => setDay(addDays(day, -1))} aria-label="Dia anterior">
            ‹
          </button>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Dia" />
          <button type="button" className="btn-icon" onClick={() => setDay(addDays(day, 1))} aria-label="Próximo dia">
            ›
          </button>
          {day !== now.ymd && (
            <button type="button" className="btn-secondary" onClick={() => setDay(now.ymd)}>
              Hoje
            </button>
          )}
        </div>
      </div>

      <div className="agenda-dayhead">
        <div>
          <h3>
            {dayLabel(day)}
            {day === now.ymd ? ' · hoje' : ''}
          </h3>
          <p>
            {open == null || close == null
              ? 'Fechado (pelo horário de atendimento)'
              : `Atendimento ${minutesToHhmm(open)}–${minutesToHhmm(close)}`}
            {' · '}
            {items.length === 1 ? '1 horário ocupado' : `${items.length} horários ocupados`}
          </p>
        </div>
        {!isAll && slots.length > 0 && (
          <button type="button" className="btn-secondary" onClick={blockDay}>
            Bloquear o dia (folga)
          </button>
        )}
      </div>

      {loadingBase || loadingDay ? (
        <p className="loading-text">Carregando...</p>
      ) : columns.length === 0 ? (
        <p className="panel-sub">Nenhum barbeiro visível na Equipe. Cadastre na aba Equipe.</p>
      ) : (
        <>
          {slots.length === 0 && (
            <p className="panel-sub">
              A barbearia está fechada neste dia. Para atender mesmo assim, mude o horário na aba Horários.
            </p>
          )}

          {slots.length > 0 && (
            <div className="agenda-scroll">
              <table
                className={`agenda-table${isAll ? ' is-multi' : ''}`}
                style={{ '--cols': columns.length } as CSSProperties}
              >
                <thead>
                  <tr>
                    <th scope="col" className="agenda-time">
                      Horário
                    </th>
                    {columns.map((b) => (
                      <th scope="col" key={b.id}>
                        {b.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => {
                    const nowRow = day === now.ymd && now.minutes >= s && now.minutes < s + STEP;
                    return (
                      <tr key={s} className={nowRow ? 'is-now' : undefined}>
                        <th scope="row" className="agenda-time">
                          {minutesToHhmm(s)}
                        </th>
                        {columns.map((b) => {
                          const hits = positioned.filter((p) => p.a.barber_id === b.id && overlaps(p, s));
                          if (!hits.length) {
                            return (
                              <td key={b.id}>
                                <button
                                  type="button"
                                  className={`slot-free${isPast(s) ? ' is-past' : ''}`}
                                  onClick={() => openNew(b.id, s)}
                                  aria-label={`${minutesToHhmm(s)} livre${isAll ? ` (${b.name})` : ''}: marcar`}
                                >
                                  Livre
                                </button>
                              </td>
                            );
                          }
                          const p = hits[0];
                          const isFirst = slots.find((x) => overlaps(p, x)) === s;
                          const title = p.a.client_name || (p.a.service ? p.a.service : 'Bloqueado');
                          return (
                            <td key={b.id}>
                              <button
                                type="button"
                                className={`slot-busy${isFirst ? '' : ' is-cont'}${p.a.client_name ? '' : ' is-block'}`}
                                onClick={() => openEdit(p.a)}
                                aria-label={`${title}, ${timeRange(p.a)}: editar`}
                              >
                                {isFirst ? (
                                  <>
                                    <strong>{title}</strong>
                                    {p.a.client_name && p.a.service && <span>{p.a.service}</span>}
                                    <small>
                                      {timeRange(p.a)}
                                      {hits.length > 1 ? ` · +${hits.length - 1}` : ''}
                                    </small>
                                    {p.a.notes && <em>{p.a.notes}</em>}
                                  </>
                                ) : (
                                  <span className="slot-cont">↳ {title}</span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {outside.length > 0 && (
            <div className="agenda-outside">
              <h4>Fora do horário de atendimento</h4>
              {outside.map((p) => (
                <button type="button" key={p.a.id} className="slot-busy" onClick={() => openEdit(p.a)}>
                  <strong>{p.a.client_name || p.a.service || 'Bloqueado'}</strong>
                  <small>
                    {timeRange(p.a)}
                    {isAll ? ` · ${barberName(p.a.barber_id)}` : ''}
                  </small>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <datalist id="agenda-services">
        {services.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <dialog ref={dialogRef} className="modal" onClose={() => setDraft(null)} aria-labelledby="agenda-modal-title">
        {draft && (
          <form className="modal-form" onSubmit={save}>
            <h3 id="agenda-modal-title">{draft.id ? 'Editar horário' : 'Marcar horário'}</h3>
            <p className="modal-sub">
              {isAdmin ? '' : `${barberName(draft.barberId)} · `}
              {dayLabel(draft.ymd)}
            </p>

            {isAdmin && (
              <label>
                Barbeiro
                <select value={draft.barberId} onChange={(e) => patchDraft({ barberId: e.target.value })}>
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="item-row">
              <label>
                Início
                <select value={draft.start} onChange={(e) => patchDraft({ start: Number(e.target.value) })}>
                  {startOptions.map((m) => (
                    <option key={m} value={m}>
                      {minutesToHhmm(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Duração
                <select value={draft.duration} onChange={(e) => patchDraft({ duration: Number(e.target.value) })}>
                  {durationOptions.map((m) => (
                    <option key={m} value={m}>
                      {durationLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="field-hint">Ocupa das {minutesToHhmm(draft.start)} às {minutesToHhmm(draft.start + draft.duration)}.</p>

            <label>
              Cliente
              <input
                value={draft.client_name}
                onChange={(e) => patchDraft({ client_name: e.target.value })}
                maxLength={80}
                placeholder="Nome do cliente (vazio = só bloquear o horário)"
                autoComplete="off"
              />
            </label>
            <label>
              Serviço / corte
              <input
                value={draft.service}
                onChange={(e) => patchDraft({ service: e.target.value })}
                list="agenda-services"
                maxLength={120}
                placeholder="Ex: Corte + barba"
                autoComplete="off"
              />
            </label>
            <label>
              Especificações do cliente
              <textarea
                rows={3}
                value={draft.notes}
                onChange={(e) => patchDraft({ notes: e.target.value })}
                maxLength={1000}
                placeholder="Ex: degradê baixo, manter volume em cima, barba desenhada"
              />
            </label>
            <p className="field-hint">Visível só para o barbeiro e o admin. No site aparece apenas “ocupado”.</p>

            <div className="modal-actions">
              <button type="submit" disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
                Cancelar
              </button>
              {draft.id && (
                <button type="button" className="btn-danger" onClick={remove} disabled={saving}>
                  Liberar horário
                </button>
              )}
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}
