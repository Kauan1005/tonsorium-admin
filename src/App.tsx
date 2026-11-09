import { useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { clearUnsaved, confirmDiscard, hasUnsavedChanges } from './lib/unsaved';
import Toaster from './components/Toaster';
import MfaSetup from './components/MfaSetup';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import MfaChallenge from './pages/MfaChallenge';
import AgendaSection from './pages/sections/AgendaSection';
import MyProfileSection from './pages/sections/MyProfileSection';
import AccountSection from './pages/sections/AccountSection';
import HeroSection from './pages/sections/HeroSection';
import ConceptSection from './pages/sections/ConceptSection';
import SpecialsSection from './pages/sections/SpecialsSection';
import ClassicsSection from './pages/sections/ClassicsSection';
import DifferentiatorsSection from './pages/sections/DifferentiatorsSection';
import GallerySection from './pages/sections/GallerySection';
import BarbersSection from './pages/sections/BarbersSection';
import HoursSection from './pages/sections/HoursSection';
import ProductsSection from './pages/sections/ProductsSection';
import LocationSection from './pages/sections/LocationSection';
import SettingsSection from './pages/sections/SettingsSection';
import ReviewsSection from './pages/sections/ReviewsSection';
import VisagismSection from './pages/sections/VisagismSection';
import ExperienceSection from './pages/sections/ExperienceSection';
import FaqSection from './pages/sections/FaqSection';

type TabKey =
  | 'agenda'
  | 'profile'
  | 'account'
  | 'hero'
  | 'concept'
  | 'visagism'
  | 'specials'
  | 'classics'
  | 'experience'
  | 'differentiators'
  | 'gallery'
  | 'barbers'
  | 'hours'
  | 'products'
  | 'reviews'
  | 'faq'
  | 'location'
  | 'settings';

type Tab = { key: TabKey; label: string };

/** Admin: agenda de todos + todo o conteúdo do site. */
const ADMIN_TABS: Tab[] = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'hero', label: 'Início' },
  { key: 'concept', label: 'Conceito' },
  { key: 'visagism', label: 'Visagismo' },
  { key: 'specials', label: 'Especiais' },
  { key: 'classics', label: 'Clássicos' },
  { key: 'experience', label: 'Experiência' },
  { key: 'differentiators', label: 'Diferenciais' },
  { key: 'gallery', label: 'Galeria' },
  { key: 'barbers', label: 'Equipe e acessos' },
  { key: 'hours', label: 'Horários' },
  { key: 'products', label: 'Produtos' },
  { key: 'reviews', label: 'Avaliações' },
  { key: 'faq', label: 'Dúvidas' },
  { key: 'location', label: 'Localização' },
  { key: 'settings', label: 'Logo & Contato' },
  { key: 'account', label: 'Minha conta' },
];

/** Barbeiro: só a própria agenda, o próprio perfil e a conta. */
const BARBER_TABS: Tab[] = [
  { key: 'agenda', label: 'Minha agenda' },
  { key: 'profile', label: 'Meu perfil' },
  { key: 'account', label: 'Minha conta' },
];

/** Sai sozinho depois de 1h sem uso (computador esquecido aberto). */
const IDLE_LIMIT_MS = 60 * 60 * 1000;

const PUBLIC_SITE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined) || '';

export default function App() {
  const { session, staff, status, signIn, signOut, sendPasswordReset, updatePassword, refresh, skipMfaEnroll } =
    useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('agenda');
  const authorized = status === 'ready' && !!session && !!staff;
  const isAdmin = staff?.role === 'admin';
  const tabs = isAdmin ? ADMIN_TABS : BARBER_TABS;

  // Troca de conta (admin -> barbeiro): volta para uma aba que a conta tem.
  useEffect(() => {
    if (authorized && !tabs.some((t) => t.key === activeTab)) setActiveTab('agenda');
  }, [authorized, tabs, activeTab]);

  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => {
    if (!authorized) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        clearUnsaved();
        signOut();
      }, IDLE_LIMIT_MS);
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized]);

  function changeTab(key: TabKey) {
    if (key === activeTab || !confirmDiscard()) return;
    clearUnsaved();
    setActiveTab(key);
  }

  function handleSignOut() {
    if (!confirmDiscard()) return;
    clearUnsaved();
    signOut();
  }

  let screen;
  if (status === 'loading') {
    screen = <div className="loading-screen">Carregando...</div>;
  } else if (status === 'recovery') {
    screen = <ResetPassword updatePassword={updatePassword} />;
  } else if (status === 'signed-out' || !session) {
    screen = <Login signIn={signIn} sendPasswordReset={sendPasswordReset} />;
  } else if (status === 'mfa-challenge') {
    screen = <MfaChallenge onVerified={refresh} onSignOut={() => signOut()} />;
  } else if (status === 'no-access' || status === 'error') {
    screen = (
      <div className="loading-screen">
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <p style={{ marginBottom: 16 }}>
            {status === 'error'
              ? 'Não foi possível conferir seu acesso agora. Verifique a internet e tente de novo.'
              : 'Essa conta não tem acesso ao painel. Barbeiros recebem o login do admin da barbearia.'}
          </p>
          <div className="panel-actions" style={{ justifyContent: 'center' }}>
            {status === 'error' && <button onClick={() => refresh()}>Tentar de novo</button>}
            <button className={status === 'error' ? 'btn-secondary' : undefined} onClick={() => signOut()}>
              Sair
            </button>
          </div>
        </div>
      </div>
    );
  } else if (status === 'mfa-enroll') {
    screen = (
      <div className="login-screen">
        <div className="login-card mfa-card">
          <img src="/logo-mark.png" alt="Tonsorium" className="login-logo" />
          <p className="login-sub">Ative a verificação em duas etapas</p>
          <p className="field-hint">
            O admin controla o site inteiro e vê os dados dos clientes na agenda. Por isso, além da senha, o painel vai
            pedir um código do app autenticador do seu celular. É só desta vez: depois, a cada login, você digita o
            código que aparece no app.
          </p>
          <MfaSetup onDone={refresh} onSkip={skipMfaEnroll} />
          <button type="button" className="btn-link" onClick={() => signOut()}>
            Sair
          </button>
        </div>
      </div>
    );
  } else if (status === 'must-change-password') {
    screen = (
      <ResetPassword
        updatePassword={updatePassword}
        title="Crie sua senha"
        intro="Seu acesso foi criado pelo admin com uma senha provisória. Escolha agora a sua senha pessoal."
        onSignOut={() => signOut()}
      />
    );
  } else if (authorized && staff) {
    screen = (
      <div className="admin-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img src="/logo-mark.png" alt="Tonsorium" className="sidebar-logo" />
            <span>{isAdmin ? 'Painel admin' : 'Painel do barbeiro'}</span>
            {!isAdmin && staff.barberName && <strong className="sidebar-user">{staff.barberName}</strong>}
          </div>
          <nav aria-label={isAdmin ? 'Seções do painel' : 'Minha área'}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={activeTab === tab.key ? 'nav-item active' : 'nav-item'}
                aria-current={activeTab === tab.key ? 'page' : undefined}
                onClick={() => changeTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          {PUBLIC_SITE_URL && (
            <a className="view-site-btn" href={PUBLIC_SITE_URL} target="_blank" rel="noreferrer">
              Ver site ↗
            </a>
          )}
          <button className="signout-btn" onClick={handleSignOut}>
            Sair
          </button>
        </aside>

        <main className={activeTab === 'agenda' ? 'content content-wide' : 'content'}>
          {activeTab === 'agenda' && <AgendaSection staff={staff} />}
          {activeTab === 'account' && <AccountSection session={session} staff={staff} onSecurityChange={refresh} />}
          {!isAdmin && activeTab === 'profile' && <MyProfileSection barberId={staff.barberId} />}
          {isAdmin && (
            <>
              {activeTab === 'hero' && <HeroSection />}
              {activeTab === 'concept' && <ConceptSection />}
              {activeTab === 'visagism' && <VisagismSection />}
              {activeTab === 'specials' && <SpecialsSection />}
              {activeTab === 'classics' && <ClassicsSection />}
              {activeTab === 'experience' && <ExperienceSection />}
              {activeTab === 'differentiators' && <DifferentiatorsSection />}
              {activeTab === 'gallery' && <GallerySection />}
              {activeTab === 'barbers' && <BarbersSection />}
              {activeTab === 'hours' && <HoursSection />}
              {activeTab === 'products' && <ProductsSection />}
              {activeTab === 'reviews' && <ReviewsSection />}
              {activeTab === 'faq' && <FaqSection />}
              {activeTab === 'location' && <LocationSection />}
              {activeTab === 'settings' && <SettingsSection />}
            </>
          )}
        </main>
      </div>
    );
  } else {
    screen = <div className="loading-screen">Carregando...</div>;
  }

  return (
    <>
      {screen}
      <Toaster />
    </>
  );
}
