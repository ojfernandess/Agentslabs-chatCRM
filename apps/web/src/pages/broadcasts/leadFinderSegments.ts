export interface LeadFinderSegmentPreset {
  id: string;
  niche: string;
  city: string;
}

export const LEAD_FINDER_SEGMENT_PRESETS: LeadFinderSegmentPreset[] = [
  { id: "hotels_sp", niche: "hotéis", city: "São Paulo, SP" },
  { id: "offices_sp", niche: "escritórios de contabilidade", city: "São Paulo, SP" },
  { id: "workshops_sp", niche: "oficinas mecânicas", city: "São Paulo, SP" },
  { id: "restaurants_sp", niche: "restaurantes", city: "São Paulo, SP" },
  { id: "clinics_sp", niche: "clínicas médicas", city: "São Paulo, SP" },
  { id: "gyms_sp", niche: "academias", city: "São Paulo, SP" },
  { id: "hotels_rj", niche: "hotéis", city: "Rio de Janeiro, RJ" },
  { id: "workshops_rj", niche: "oficinas mecânicas", city: "Rio de Janeiro, RJ" },
  { id: "dentists_bh", niche: "dentistas", city: "Belo Horizonte, MG" },
  { id: "real_estate_sp", niche: "imobiliárias", city: "São Paulo, SP" },
];
