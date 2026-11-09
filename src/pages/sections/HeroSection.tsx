import { useSingleRow } from '../../hooks/useSingleRow';
import MediaUpload from '../../components/MediaUpload';
import SaveBar from '../../components/SaveBar';
import type { Hero } from '../../types';

const EMPTY: Hero = {
  id: 1,
  badge_text: '',
  title: '',
  tagline: '',
  subtitle: '',
  whatsapp_number: '',
  hero_media_url: '',
  hero_media_type: 'none',
};

export default function HeroSection() {
  const { data, loading, saving, dirty, update, save, saveFields } = useSingleRow('site_hero', EMPTY, ['hero_media_url']);

  if (loading) return <p className="loading-text">Carregando...</p>;

  return (
    <section className="panel">
      <h2>Início (topo do site)</h2>
      <p className="panel-sub">Textos principais que aparecem assim que alguém abre o site.</p>

      <label>
        Selo de contexto
        <input
          value={data.badge_text}
          onChange={(e) => update('badge_text', e.target.value)}
          placeholder="Barbearia · Itapevi, SP"
          maxLength={80}
        />
      </label>

      <label>
        Título principal
        <input value={data.title} onChange={(e) => update('title', e.target.value)} placeholder="Tonsorium" maxLength={60} />
      </label>

      <label>
        Slogan
        <input
          value={data.tagline}
          onChange={(e) => update('tagline', e.target.value)}
          placeholder="Um conceito criado para você"
          maxLength={120}
        />
      </label>

      <label>
        Texto de apoio
        <textarea rows={3} value={data.subtitle} onChange={(e) => update('subtitle', e.target.value)} maxLength={400} />
      </label>

      <p className="panel-sub" style={{ marginTop: -8 }}>
        O número de WhatsApp usado em todos os botões do site fica na aba <strong>Localização</strong>.
      </p>

      <SaveBar saving={saving} dirty={dirty} onSave={save} />

      <hr className="panel-divider" />

      <h3 className="panel-subtitle">Fundo do topo (foto ou vídeo)</h3>
      <p className="panel-sub" style={{ marginTop: -8 }}>
        Opcional. Envie qualquer formato (foto do iPhone, vídeo do WhatsApp, etc.) — o sistema converte
        automaticamente e já publica no site assim que o envio termina.
      </p>

      {data.hero_media_type === 'image' && data.hero_media_url && (
        <img src={data.hero_media_url} alt="Fundo do topo" className="gallery-thumb" />
      )}
      {data.hero_media_type === 'video' && data.hero_media_url && (
        <video src={data.hero_media_url} className="gallery-thumb" muted loop autoPlay playsInline />
      )}

      <MediaUpload
        prefix="hero"
        allowVideo
        minWidth={1920}
        onUploaded={(url, type) => saveFields({ hero_media_url: url, hero_media_type: type })}
      />
      <p className="panel-sub" style={{ marginTop: 8 }}>
        A conversão roda no seu computador — em uma máquina comum, um vídeo de até 15–20s normalmente fica pronto
        em menos de 1 minuto. Tamanho máximo final: 50MB.
      </p>

      {data.hero_media_url && (
        <button
          type="button"
          className="btn-danger"
          onClick={() => {
            if (confirm('Remover o fundo do topo?')) saveFields({ hero_media_url: '', hero_media_type: 'none' });
          }}
          style={{ marginTop: 8 }}
        >
          Remover fundo
        </button>
      )}
    </section>
  );
}
