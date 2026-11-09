export type HeroMediaType = 'none' | 'image' | 'video';

export interface Hero {
  id: number;
  badge_text: string;
  title: string;
  tagline: string;
  subtitle: string;
  whatsapp_number: string;
  hero_media_url: string;
  hero_media_type: HeroMediaType;
}

export interface Concept {
  id: number;
  eyebrow: string;
  title: string;
  paragraph_1: string;
  paragraph_2: string;
}

export interface Pillar {
  id: string;
  position: number;
  title: string;
  description: string;
}

export interface SpecialService {
  id: string;
  tag: string;
  title: string;
  description: string;
  price_label: string;
  position: number;
  active: boolean;
}

export interface ClassicService {
  id: string;
  title: string;
  description: string;
  price_label: string;
  position: number;
  active: boolean;
}

export type DifferentiatorIcon =
  | 'clock'
  | 'shield'
  | 'home'
  | 'chart'
  | 'calendar'
  | 'heart';

export interface Differentiator {
  id: string;
  icon: DifferentiatorIcon;
  title: string;
  description: string;
  position: number;
  active: boolean;
}

export interface LocationInfo {
  id: number;
  address: string;
  neighborhood_city: string;
  whatsapp_number: string;
  maps_url: string;
}

export interface SiteSettings {
  id: number;
  logo_url: string;
  instagram_handle: string;
  phone_display: string;
}

export interface GalleryPhoto {
  id: string;
  image_url: string;
  caption: string;
  position: number;
  active: boolean;
}

export interface Barber {
  id: string;
  name: string;
  role: string;
  bio: string;
  quote: string;
  photo_url: string;
  position: number;
  active: boolean;
}

export interface BusinessHour {
  id: string;
  day_of_week: number; // 0 = domingo, 1 = segunda ... 6 = sábado
  is_closed: boolean;
  open_time: string;
  close_time: string;
}

/** Quem está logado no painel: admin (tudo) ou barbeiro (agenda e perfil próprios). */
export type StaffRole = 'admin' | 'barber';

export interface StaffContext {
  role: StaffRole;
  barberId: string | null;
  barberName: string;
}

/** Login de barbeiro (só o admin vê). */
export interface StaffAccount {
  barber_id: string;
  user_id: string;
  email: string;
  last_sign_in_at: string | null;
  mfa_enabled: boolean;
}

/** Horário ocupado na agenda de um barbeiro (atendimento ou bloqueio). */
export interface Appointment {
  id: string;
  barber_id: string;
  starts_at: string;
  ends_at: string;
  client_name: string;
  service: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export const WEEKDAY_LABELS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
] as const;

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  photo_url: string;
  position: number;
  active: boolean;
}

export interface Visagism {
  id: number;
  active: boolean;
  eyebrow: string;
  title: string;
  intro: string;
  cta_label: string;
  service_name: string;
}

export interface VisagismPoint {
  id: string;
  title: string;
  description: string;
  position: number;
  active: boolean;
}

export interface ExperienceStep {
  id: string;
  title: string;
  description: string;
  position: number;
  active: boolean;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  position: number;
  active: boolean;
}

export type ReviewStatus = 'published' | 'hidden';

export interface Review {
  id: string;
  user_id: string;
  author_name: string;
  rating: number;
  comment: string;
  status: ReviewStatus;
  admin_reply: string;
  author_avatar_url?: string;
  created_at: string;
  updated_at: string;
  edited_at?: string | null;
}

export interface GooglePlace {
  id: number;
  place_id: string;
  show_on_site: boolean;
  rating: number | null;
  user_rating_count: number | null;
  maps_uri: string;
  last_synced_at: string | null;
  last_error: string;
}

export interface GoogleReview {
  id: string;
  author_name: string;
  author_photo_url: string;
  author_uri: string;
  rating: number;
  text: string;
  relative_time: string;
  publish_time: string | null;
}