/** Catálogo de categorias de negócio — extensão do Deal genérico (sem entidades por setor). */

export type DealCategoryId =
  | "default"
  | "hospitality"
  | "restaurants_events"
  | "legal"
  | "clinic"
  | "real_estate"
  | "education"
  | "saas"
  | "professional_services"
  | "automotive"
  | "travel"
  | "custom";

export type DealFieldType =
  | "text"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "select"
  | "multiselect"
  | "boolean"
  | "percentage";

export type DealFieldDef = {
  key: string;
  labelPt: string;
  labelEn: string;
  type: DealFieldType;
  required?: boolean;
  enabled?: boolean;
  sortOrder: number;
  /** Referência a DealOptionSet.setKey */
  optionSetKey?: string;
  /** Sugestão de cálculo (não substitui amountCents / line items). */
  computeHint?: "dailyRate_times_nights" | "ticket_times_guests" | "sessionPrice_times_sessions";
};

export type DealOptionSetTemplate = {
  setKey: string;
  labelPt: string;
  labelEn: string;
  suggestedOptions: string[];
};

export type DealTypeOption = {
  key: string;
  labelPt: string;
  labelEn: string;
};

export type DealCategoryDef = {
  id: DealCategoryId;
  labelPt: string;
  labelEn: string;
  descriptionPt: string;
  descriptionEn: string;
  fields: DealFieldDef[];
  optionSetTemplates?: DealOptionSetTemplate[];
  dealTypes?: DealTypeOption[];
};

const F = (
  key: string,
  labelPt: string,
  labelEn: string,
  type: DealFieldType,
  sortOrder: number,
  extra?: Partial<DealFieldDef>,
): DealFieldDef => ({
  key,
  labelPt,
  labelEn,
  type,
  sortOrder,
  enabled: true,
  required: false,
  ...extra,
});

export const DEAL_CATEGORY_CATALOG: DealCategoryDef[] = [
  {
    id: "default",
    labelPt: "Padrão / Comercial",
    labelEn: "Default / Commercial",
    descriptionPt: "Comportamento actual — sem campos adicionais obrigatórios.",
    descriptionEn: "Current behavior — no additional required fields.",
    fields: [],
  },
  {
    id: "hospitality",
    labelPt: "Hotelaria e Hospedagem",
    labelEn: "Hospitality",
    descriptionPt: "Reservas, diárias, hóspedes e período de hospedagem.",
    descriptionEn: "Reservations, daily rates, guests, and stay period.",
    dealTypes: [
      { key: "reservation", labelPt: "Reserva", labelEn: "Reservation" },
      { key: "stay", labelPt: "Hospedagem", labelEn: "Stay" },
      { key: "group", labelPt: "Grupo", labelEn: "Group" },
      { key: "event", labelPt: "Evento", labelEn: "Event" },
      { key: "long_stay", labelPt: "Long stay", labelEn: "Long stay" },
      { key: "day_use", labelPt: "Day use", labelEn: "Day use" },
      { key: "other", labelPt: "Outro", labelEn: "Other" },
    ],
    optionSetTemplates: [
      {
        setKey: "guest_types",
        labelPt: "Tipos de hóspede",
        labelEn: "Guest types",
        suggestedOptions: [
          "Lazer",
          "Corporativo",
          "Evento",
          "Grupo",
          "Tripulação",
          "Long Stay",
          "OTA",
          "Direto",
          "Agência",
        ],
      },
      {
        setKey: "accommodation_types",
        labelPt: "Categorias de acomodação",
        labelEn: "Accommodation categories",
        suggestedOptions: ["Standard", "Superior", "Luxo", "Suíte", "Apartamento"],
      },
    ],
    fields: [
      F("dealType", "Tipo de negócio", "Deal type", "select", 1, { optionSetKey: "deal_types_hospitality" }),
      F("dailyRateCents", "Valor da diária", "Daily rate", "money", 2, { computeHint: "dailyRate_times_nights" }),
      F("nights", "Quantidade de diárias", "Number of nights", "number", 3, { computeHint: "dailyRate_times_nights" }),
      F("estimatedTotalCents", "Valor total estimado", "Estimated total", "money", 4),
      F("checkinDate", "Check-in", "Check-in", "date", 5),
      F("checkoutDate", "Check-out", "Check-out", "date", 6),
      F("guestsQuantity", "Número de hóspedes", "Number of guests", "number", 7),
      F("guestTypeId", "Tipo de hóspede", "Guest type", "select", 8, { optionSetKey: "guest_types" }),
      F("accommodationTypeId", "Categoria de acomodação", "Accommodation category", "select", 9, {
        optionSetKey: "accommodation_types",
      }),
      F("unitName", "Unidade / hotel", "Unit / hotel", "text", 10),
      F("reservationCode", "Código da reserva", "Reservation code", "text", 11),
      F("notes", "Observações", "Notes", "text", 12),
    ],
  },
  {
    id: "restaurants_events",
    labelPt: "Restaurantes e Eventos",
    labelEn: "Restaurants & Events",
    descriptionPt: "Reservas, eventos, catering e ticket por pessoa.",
    descriptionEn: "Reservations, events, catering, and per-person ticket.",
    dealTypes: [
      { key: "reservation", labelPt: "Reserva", labelEn: "Reservation" },
      { key: "event", labelPt: "Evento", labelEn: "Event" },
      { key: "group", labelPt: "Grupo", labelEn: "Group" },
      { key: "corporate", labelPt: "Corporativo", labelEn: "Corporate" },
      { key: "delivery", labelPt: "Delivery", labelEn: "Delivery" },
      { key: "catering", labelPt: "Catering", labelEn: "Catering" },
      { key: "other", labelPt: "Outro", labelEn: "Other" },
    ],
    optionSetTemplates: [
      {
        setKey: "event_types",
        labelPt: "Tipos de evento",
        labelEn: "Event types",
        suggestedOptions: ["Aniversário", "Corporativo", "Casamento", "Confraternização", "Jantar", "Almoço"],
      },
    ],
    fields: [
      F("dealType", "Tipo de negócio", "Deal type", "select", 1),
      F("reservationDate", "Data da reserva", "Reservation date", "date", 2),
      F("reservationTime", "Horário", "Time", "text", 3),
      F("guestsQuantity", "Quantidade de pessoas", "Number of guests", "number", 4, {
        computeHint: "ticket_times_guests",
      }),
      F("eventTypeId", "Tipo de evento", "Event type", "select", 5, { optionSetKey: "event_types" }),
      F("ticketPerPersonCents", "Ticket por pessoa", "Ticket per person", "money", 6, {
        computeHint: "ticket_times_guests",
      }),
      F("estimatedTotalCents", "Valor estimado", "Estimated total", "money", 7),
      F("unitName", "Unidade", "Unit", "text", 8),
      F("tableOrHall", "Mesa / salão", "Table / hall", "text", 9),
      F("notes", "Observações", "Notes", "text", 10),
    ],
  },
  {
    id: "legal",
    labelPt: "Advocacia / Jurídico",
    labelEn: "Legal",
    descriptionPt: "Consultas, contratos, processos e honorários.",
    descriptionEn: "Consultations, contracts, cases, and fees.",
    dealTypes: [
      { key: "consultation", labelPt: "Consulta", labelEn: "Consultation" },
      { key: "contract", labelPt: "Contrato", labelEn: "Contract" },
      { key: "case", labelPt: "Processo", labelEn: "Case" },
      { key: "advisory", labelPt: "Assessoria", labelEn: "Advisory" },
      { key: "fees", labelPt: "Honorários", labelEn: "Fees" },
      { key: "other", labelPt: "Outro", labelEn: "Other" },
    ],
    optionSetTemplates: [
      {
        setKey: "legal_areas",
        labelPt: "Áreas jurídicas",
        labelEn: "Legal areas",
        suggestedOptions: [
          "Trabalhista",
          "Civil",
          "Família",
          "Empresarial",
          "Tributário",
          "Imobiliário",
          "Previdenciário",
          "Criminal",
        ],
      },
    ],
    fields: [
      F("dealType", "Tipo de negócio", "Deal type", "select", 1),
      F("legalAreaId", "Área jurídica", "Legal area", "select", 2, { optionSetKey: "legal_areas" }),
      F("serviceType", "Tipo de atendimento", "Service type", "text", 3),
      F("estimatedFeesCents", "Honorários estimados", "Estimated fees", "money", 4),
      F("billingType", "Tipo de cobrança", "Billing type", "text", 5),
      F("caseNumber", "Número do processo", "Case number", "text", 6),
      F("clientType", "Cliente PF/PJ", "Client type", "select", 7),
      F("expectedDate", "Data prevista", "Expected date", "date", 8),
      F("notes", "Observações", "Notes", "text", 9),
    ],
  },
  {
    id: "clinic",
    labelPt: "Clínicas e Consultórios",
    labelEn: "Clinics & Practices",
    descriptionPt: "Consultas, procedimentos e pacotes (dados administrativos).",
    descriptionEn: "Consultations, procedures, and packages (admin data only).",
    dealTypes: [
      { key: "consultation", labelPt: "Consulta", labelEn: "Consultation" },
      { key: "procedure", labelPt: "Procedimento", labelEn: "Procedure" },
      { key: "treatment", labelPt: "Tratamento", labelEn: "Treatment" },
      { key: "package", labelPt: "Pacote", labelEn: "Package" },
      { key: "followup", labelPt: "Retorno", labelEn: "Follow-up" },
      { key: "other", labelPt: "Outro", labelEn: "Other" },
    ],
    optionSetTemplates: [
      {
        setKey: "specialties",
        labelPt: "Especialidades",
        labelEn: "Specialties",
        suggestedOptions: ["Clínica geral", "Fisioterapia", "Odontologia", "Dermatologia", "Psicologia"],
      },
      {
        setKey: "patient_types",
        labelPt: "Tipos de paciente",
        labelEn: "Patient types",
        suggestedOptions: ["Particular", "Convênio", "Empresa"],
      },
    ],
    fields: [
      F("dealType", "Tipo de negócio", "Deal type", "select", 1),
      F("specialtyId", "Especialidade", "Specialty", "select", 2, { optionSetKey: "specialties" }),
      F("professionalName", "Profissional", "Professional", "text", 3),
      F("patientTypeId", "Tipo de paciente", "Patient type", "select", 4, { optionSetKey: "patient_types" }),
      F("appointmentDate", "Data de atendimento", "Appointment date", "date", 5),
      F("procedureName", "Procedimento", "Procedure", "text", 6),
      F("sessionsCount", "Quantidade de sessões", "Sessions", "number", 7, {
        computeHint: "sessionPrice_times_sessions",
      }),
      F("sessionPriceCents", "Valor da sessão", "Session price", "money", 8, {
        computeHint: "sessionPrice_times_sessions",
      }),
      F("estimatedTotalCents", "Valor total estimado", "Estimated total", "money", 9),
      F("insuranceType", "Convênio / particular", "Insurance / private", "text", 10),
      F("notes", "Observações", "Notes", "text", 11),
    ],
  },
  {
    id: "real_estate",
    labelPt: "Imobiliário",
    labelEn: "Real Estate",
    descriptionPt: "Vendas, locações, visitas e propostas.",
    descriptionEn: "Sales, rentals, visits, and proposals.",
    dealTypes: [
      { key: "sale", labelPt: "Venda", labelEn: "Sale" },
      { key: "rent", labelPt: "Locação", labelEn: "Rent" },
      { key: "visit", labelPt: "Visita", labelEn: "Visit" },
      { key: "proposal", labelPt: "Proposta", labelEn: "Proposal" },
      { key: "contract", labelPt: "Contrato", labelEn: "Contract" },
    ],
    fields: [
      F("dealType", "Tipo de negócio", "Deal type", "select", 1),
      F("propertyName", "Imóvel", "Property", "text", 2),
      F("propertyCode", "Código do imóvel", "Property code", "text", 3),
      F("propertyType", "Tipo do imóvel", "Property type", "text", 4),
      F("commissionCents", "Comissão", "Commission", "money", 5),
      F("visitDate", "Data da visita", "Visit date", "date", 6),
      F("brokerName", "Corretor", "Broker", "text", 7),
      F("clientType", "Tipo do cliente", "Client type", "text", 8),
      F("notes", "Observações", "Notes", "text", 9),
    ],
  },
  {
    id: "education",
    labelPt: "Educação",
    labelEn: "Education",
    descriptionPt: "Matrículas, cursos e pacotes educacionais.",
    descriptionEn: "Enrollments, courses, and education packages.",
    fields: [
      F("dealType", "Tipo de negócio", "Deal type", "select", 1),
      F("courseName", "Curso / programa", "Course / program", "text", 2),
      F("enrollmentDate", "Data de matrícula", "Enrollment date", "date", 3),
      F("studentsCount", "Quantidade de alunos", "Students", "number", 4),
      F("estimatedTotalCents", "Valor estimado", "Estimated total", "money", 5),
      F("notes", "Observações", "Notes", "text", 6),
    ],
  },
  {
    id: "saas",
    labelPt: "SaaS / Tecnologia",
    labelEn: "SaaS / Technology",
    descriptionPt: "Assinaturas, upgrades e expansão.",
    descriptionEn: "Subscriptions, upgrades, and expansion.",
    dealTypes: [
      { key: "new_subscription", labelPt: "Nova assinatura", labelEn: "New subscription" },
      { key: "upgrade", labelPt: "Upgrade", labelEn: "Upgrade" },
      { key: "renewal", labelPt: "Renovação", labelEn: "Renewal" },
      { key: "expansion", labelPt: "Expansão", labelEn: "Expansion" },
      { key: "service", labelPt: "Serviço", labelEn: "Service" },
      { key: "project", labelPt: "Projeto", labelEn: "Project" },
    ],
    fields: [
      F("dealType", "Tipo de negócio", "Deal type", "select", 1),
      F("planName", "Plano", "Plan", "text", 2),
      F("mrrCents", "MRR", "MRR", "money", 3),
      F("arrCents", "ARR", "ARR", "money", 4),
      F("seatsCount", "Quantidade de usuários", "Seats", "number", 5),
      F("billingCycle", "Ciclo", "Billing cycle", "text", 6),
      F("startDate", "Data de início", "Start date", "date", 7),
      F("renewalDate", "Data de renovação", "Renewal date", "date", 8),
      F("contractType", "Tipo de contrato", "Contract type", "text", 9),
    ],
  },
  {
    id: "professional_services",
    labelPt: "Serviços Profissionais",
    labelEn: "Professional Services",
    descriptionPt: "Projetos, consultoria e contratos de serviço.",
    descriptionEn: "Projects, consulting, and service contracts.",
    dealTypes: [
      { key: "project", labelPt: "Projeto", labelEn: "Project" },
      { key: "contract", labelPt: "Contrato", labelEn: "Contract" },
      { key: "consulting", labelPt: "Consultoria", labelEn: "Consulting" },
      { key: "implementation", labelPt: "Implantação", labelEn: "Implementation" },
      { key: "maintenance", labelPt: "Manutenção", labelEn: "Maintenance" },
      { key: "other", labelPt: "Outro", labelEn: "Other" },
    ],
    fields: [
      F("dealType", "Tipo de negócio", "Deal type", "select", 1),
      F("serviceType", "Tipo de serviço", "Service type", "text", 2),
      F("estimatedHours", "Horas estimadas", "Estimated hours", "number", 3),
      F("hourlyRateCents", "Valor hora", "Hourly rate", "money", 4),
      F("projectValueCents", "Valor do projeto", "Project value", "money", 5),
      F("startDate", "Data de início", "Start date", "date", 6),
      F("expectedEndDate", "Data prevista", "Expected end", "date", 7),
      F("notes", "Observações", "Notes", "text", 8),
    ],
  },
  {
    id: "automotive",
    labelPt: "Automotivo",
    labelEn: "Automotive",
    descriptionPt: "Vendas, serviços e peças.",
    descriptionEn: "Sales, services, and parts.",
    fields: [
      F("dealType", "Tipo de negócio", "Deal type", "select", 1),
      F("vehicleModel", "Veículo", "Vehicle", "text", 2),
      F("serviceType", "Tipo de serviço", "Service type", "text", 3),
      F("estimatedTotalCents", "Valor estimado", "Estimated total", "money", 4),
      F("notes", "Observações", "Notes", "text", 5),
    ],
  },
  {
    id: "travel",
    labelPt: "Turismo",
    labelEn: "Travel",
    descriptionPt: "Pacotes, roteiros e viagens.",
    descriptionEn: "Packages, itineraries, and trips.",
    fields: [
      F("dealType", "Tipo de negócio", "Deal type", "select", 1),
      F("destination", "Destino", "Destination", "text", 2),
      F("departureDate", "Data de partida", "Departure", "date", 3),
      F("returnDate", "Data de retorno", "Return", "date", 4),
      F("travelersCount", "Viajantes", "Travelers", "number", 5),
      F("estimatedTotalCents", "Valor estimado", "Estimated total", "money", 6),
      F("notes", "Observações", "Notes", "text", 7),
    ],
  },
  {
    id: "custom",
    labelPt: "Personalizada",
    labelEn: "Custom",
    descriptionPt: "Campos definidos pela organização.",
    descriptionEn: "Organization-defined fields.",
    fields: [],
  },
];

export function getDealCategoryById(id: string | null | undefined): DealCategoryDef {
  const key = id?.trim() || "default";
  return DEAL_CATEGORY_CATALOG.find((c) => c.id === key) ?? DEAL_CATEGORY_CATALOG[0]!;
}

export function normalizeDealCategory(id: string | null | undefined): DealCategoryId {
  const found = DEAL_CATEGORY_CATALOG.find((c) => c.id === id);
  return found?.id ?? "default";
}

/** Calcula valor sugerido a partir de categoryData (não altera line items). */
export function suggestAmountCentsFromCategoryData(
  categoryId: string,
  data: Record<string, unknown> | null | undefined,
): number | null {
  if (!data) return null;
  const cat = getDealCategoryById(categoryId);
  for (const field of cat.fields) {
    if (field.computeHint === "dailyRate_times_nights") {
      const rate = Number(data.dailyRateCents);
      const nights = Number(data.nights);
      if (Number.isFinite(rate) && Number.isFinite(nights) && rate >= 0 && nights > 0) {
        return Math.round(rate * nights);
      }
    }
    if (field.computeHint === "ticket_times_guests") {
      const ticket = Number(data.ticketPerPersonCents);
      const guests = Number(data.guestsQuantity);
      if (Number.isFinite(ticket) && Number.isFinite(guests) && ticket >= 0 && guests > 0) {
        return Math.round(ticket * guests);
      }
    }
    if (field.computeHint === "sessionPrice_times_sessions") {
      const price = Number(data.sessionPriceCents);
      const sessions = Number(data.sessionsCount);
      if (Number.isFinite(price) && Number.isFinite(sessions) && price >= 0 && sessions > 0) {
        return Math.round(price * sessions);
      }
    }
  }
  return null;
}
