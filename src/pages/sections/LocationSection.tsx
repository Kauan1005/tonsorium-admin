import { useSingleRow } from '../../hooks/useSingleRow';
import { toast } from '../../lib/toast';
import SaveBar from '../../components/SaveBar';
import type { LocationInfo } from '../../types';

const EMPTY: LocationInfo = {
  id: 1,
  address: '',
  neighborhood_city: '',
  whatsapp_number: '',
  maps_url: '',
};

export default function LocationSection() {
  const { data, loading, saving, dirty, update, save } = useSingleRow('site_location', EMPTY);

  async function handleSave() {
    if (data.whatsapp_number && !/^[0-9]{10,15}$/.test(data.whatsapp_number)) {
      toast('WhatsApp inválido: use DDI + DDD + número, ex: 5511912369764.', 'error');
      return;
    }
    if (data.maps_url && !/^https:\/\/\S+$/.test(data.maps_url)) {
      toast('O link do Google Maps precisa começar com https://', 'error');
      return;
    }
    await save();
  }

  if (loading) return <p className="loading-text">Carregando...</p>;

  return (
    <section className="panel">
      <h2>Localização & WhatsApp</h2>
      <p className="panel-sub">Endereço, mapa e o WhatsApp usado em todos os botões de agendamento do site.</p>

      <label>
        Endereço (rua e número)
        <input value={data.address} onChange={(e) => update('address', e.target.value)} maxLength={120} />
      </label>

      <label>
        Bairro / Cidade
        <input value={data.neighborhood_city} onChange={(e) => update('neighborhood_city', e.target.value)} maxLength={120} />
      </label>

      <p className="panel-sub" style={{ marginTop: -8 }}>
        O horário de funcionamento é editado na aba <strong>Horários</strong>.
      </p>

      <label>
        WhatsApp (DDI + DDD + número)
        <input
          inputMode="numeric"
          value={data.whatsapp_number}
          onChange={(e) => update('whatsapp_number', e.target.value.replace(/\D/g, ''))}
          placeholder="5511912369764"
          maxLength={15}
        />
      </label>

      <label>
        Link do Google Maps (botão "Abrir no Maps")
        <input
          value={data.maps_url}
          onChange={(e) => update('maps_url', e.target.value.trim())}
          placeholder="https://maps.app.goo.gl/..."
        />
      </label>

      <SaveBar saving={saving} dirty={dirty} onSave={handleSave} />
    </section>
  );
}
