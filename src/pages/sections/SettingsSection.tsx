import { useSingleRow } from '../../hooks/useSingleRow';
import MediaUpload from '../../components/MediaUpload';
import SaveBar from '../../components/SaveBar';
import type { SiteSettings } from '../../types';

const EMPTY: SiteSettings = { id: 1, logo_url: '', instagram_handle: '', phone_display: '' };

/** Aceita "@usuario", "usuario" ou o link do perfil e guarda só o usuário. */
function normalizeInstagram(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .replace(/[^A-Za-z0-9._]/g, '')
    .slice(0, 30);
}

export default function SettingsSection() {
  const { data, loading, saving, dirty, update, save, saveFields } = useSingleRow('site_settings', EMPTY, ['logo_url']);

  if (loading) return <p className="loading-text">Carregando...</p>;

  return (
    <section className="panel">
      <h2>Logo & contato</h2>
      <p className="panel-sub">Identidade visual e canais de contato usados no site.</p>

      <label>Logo atual (publicado assim que o envio termina)</label>
      {data.logo_url && <img src={data.logo_url} alt="Logo da Tonsorium" className="logo-preview" />}
      <MediaUpload prefix="logo" minWidth={400} onUploaded={(url) => saveFields({ logo_url: url })} />

      <label style={{ marginTop: 16 }}>
        Instagram (usuário ou link do perfil)
        <input
          value={data.instagram_handle}
          onChange={(e) => update('instagram_handle', normalizeInstagram(e.target.value))}
          placeholder="barbeariatonsorium"
        />
      </label>

      <label>
        Telefone exibido no site
        <input
          value={data.phone_display}
          onChange={(e) => update('phone_display', e.target.value)}
          placeholder="(11) 91236-9764"
          maxLength={30}
        />
      </label>

      <SaveBar saving={saving} dirty={dirty} onSave={save} />
    </section>
  );
}
