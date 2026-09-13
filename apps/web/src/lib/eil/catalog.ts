/** Operadores suportados pelo runtime EIL. */
export const EIL_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "exists", "not_exists"] as const;
export type EilOp = (typeof EIL_OPS)[number];

export type EilFactType = "number" | "string" | "boolean" | "date" | "array" | "object";

export type EilActionDef = {
  id: string;
  labelPt: string;
  labelEn: string;
  descriptionPt: string;
  descriptionEn: string;
};

/** Ações reconhecidas pelo runtime (detectReplyActions + políticas). */
export const EIL_ACTION_CATALOG: EilActionDef[] = [
  {
    id: "request_additional_party",
    labelPt: "Solicitar dados de acompanhantes",
    labelEn: "Request companion / additional party data",
    descriptionPt: "Pedir cadastro ou dados de acompanhantes ou convidados adicionais.",
    descriptionEn: "Ask for companion or additional guest registration data.",
  },
  {
    id: "confirm",
    labelPt: "Confirmar dados ou reserva",
    labelEn: "Confirm data or reservation",
    descriptionPt: "Pedir confirmação explícita (sim/não) ao cliente.",
    descriptionEn: "Ask the customer for explicit confirmation.",
  },
  {
    id: "escalate_human",
    labelPt: "Escalar para atendente",
    labelEn: "Escalate to human agent",
    descriptionPt: "Transferir ou escalar para atendimento humano.",
    descriptionEn: "Transfer or escalate to a human agent.",
  },
  {
    id: "ask_document",
    labelPt: "Solicitar documento",
    labelEn: "Request document",
    descriptionPt: "Pedir CPF, RG, passaporte ou outro documento.",
    descriptionEn: "Request ID, passport, or other document.",
  },
  {
    id: "ask_payment",
    labelPt: "Solicitar pagamento",
    labelEn: "Request payment",
    descriptionPt: "Pedir pagamento, comprovante ou status de fatura.",
    descriptionEn: "Request payment, receipt, or invoice status.",
  },
  {
    id: "complete_flow",
    labelPt: "Finalizar atendimento",
    labelEn: "Complete flow",
    descriptionPt: "Concluir check-in, fluxo ou atendimento.",
    descriptionEn: "Complete check-in, flow, or service.",
  },
  {
    id: "assert_operational_data",
    labelPt: "Informar dados operacionais",
    labelEn: "Assert operational data",
    descriptionPt: "Informar que dados foram encontrados ou validados.",
    descriptionEn: "State that data was found or validated.",
  },
];

export type EilFactDef = {
  key: string;
  labelPt: string;
  labelEn: string;
  type: EilFactType;
  category: "reservation" | "guest" | "payment" | "conversation" | "other";
  descriptionPt?: string;
  descriptionEn?: string;
};

/** Catálogo base de facts (complementado por config.eil das ferramentas). */
export const EIL_FACT_CATALOG: EilFactDef[] = [
  { key: "guestsQuantity", labelPt: "Quantidade de hóspedes", labelEn: "Guest count", type: "number", category: "reservation" },
  { key: "reservationStatus", labelPt: "Status da reserva", labelEn: "Reservation status", type: "string", category: "reservation" },
  { key: "checkinStatus", labelPt: "Status do check-in", labelEn: "Check-in status", type: "string", category: "reservation" },
  { key: "reservationId", labelPt: "ID da reserva", labelEn: "Reservation ID", type: "string", category: "reservation" },
  { key: "localizadorOuReservationId", labelPt: "Localizador / ID reserva", labelEn: "Locator / reservation ID", type: "string", category: "reservation" },
  { key: "name", labelPt: "Nome", labelEn: "Name", type: "string", category: "guest" },
  { key: "email", labelPt: "E-mail", labelEn: "Email", type: "string", category: "guest" },
  { key: "documentNumber", labelPt: "Número do documento", labelEn: "Document number", type: "string", category: "guest" },
  { key: "phone", labelPt: "Telefone", labelEn: "Phone", type: "string", category: "guest" },
  { key: "mobilePhoneNumber", labelPt: "Celular", labelEn: "Mobile phone", type: "string", category: "guest" },
  { key: "mainGuestId", labelPt: "ID hóspede principal", labelEn: "Main guest ID", type: "string", category: "guest" },
  { key: "found", labelPt: "Cadastro encontrado", labelEn: "Record found", type: "boolean", category: "guest" },
];

export type EilOpDef = {
  op: EilOp;
  labelPt: string;
  labelEn: string;
  needsValue: boolean;
  types: EilFactType[];
};

export const EIL_OPERATOR_CATALOG: EilOpDef[] = [
  { op: "eq", labelPt: "é igual a", labelEn: "equals", needsValue: true, types: ["number", "string", "boolean", "date"] },
  { op: "neq", labelPt: "é diferente de", labelEn: "not equals", needsValue: true, types: ["number", "string", "boolean", "date"] },
  { op: "gt", labelPt: "maior que", labelEn: "greater than", needsValue: true, types: ["number", "date"] },
  { op: "gte", labelPt: "maior ou igual a", labelEn: "greater or equal", needsValue: true, types: ["number", "date"] },
  { op: "lt", labelPt: "menor que", labelEn: "less than", needsValue: true, types: ["number", "date"] },
  { op: "lte", labelPt: "menor ou igual a", labelEn: "less or equal", needsValue: true, types: ["number", "date"] },
  { op: "exists", labelPt: "existe", labelEn: "exists", needsValue: false, types: ["number", "string", "boolean", "date", "array", "object"] },
  { op: "not_exists", labelPt: "não existe", labelEn: "does not exist", needsValue: false, types: ["number", "string", "boolean", "date", "array", "object"] },
];

export function getActionLabel(actionId: string, locale: "pt" | "en"): string {
  const found = EIL_ACTION_CATALOG.find((a) => a.id === actionId);
  if (!found) return actionId;
  return locale === "pt" ? found.labelPt : found.labelEn;
}

export function getFactLabel(factKey: string, locale: "pt" | "en"): string {
  const found = EIL_FACT_CATALOG.find((f) => f.key === factKey);
  if (!found) return factKey;
  return locale === "pt" ? found.labelPt : found.labelEn;
}

export function getOpLabel(op: string, locale: "pt" | "en"): string {
  const found = EIL_OPERATOR_CATALOG.find((o) => o.op === op);
  if (!found) return op;
  return locale === "pt" ? found.labelPt : found.labelEn;
}

export function operatorsForFactType(type: EilFactType): EilOpDef[] {
  return EIL_OPERATOR_CATALOG.filter((o) => o.types.includes(type));
}

export function slugifyPolicyId(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** Templates de políticas (aplicados via UI, não tratamento especial no runtime). */
export const EIL_POLICY_TEMPLATES = [
  {
    eilCategory: "hospitality",
    category: "reservations",
    id: "party_requires_n_gt_1",
    namePt: "Solicitar acompanhantes somente quando necessário",
    nameEn: "Request companions only when needed",
    descriptionPt: "Evita solicitar dados de acompanhantes quando a reserva possui somente um hóspede.",
    descriptionEn: "Avoid requesting companion data when the reservation has only one guest.",
    policy: {
      id: "party_requires_n_gt_1",
      action: "request_additional_party",
      requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
      forbids: [],
    },
  },
  {
    eilCategory: "hospitality",
    category: "reservations",
    id: "confirm_active_reservation",
    namePt: "Confirmar reserva apenas se estiver ativa",
    nameEn: "Confirm reservation only when active",
    descriptionPt: "Permite confirmar somente quando o status da reserva é confirmada.",
    descriptionEn: "Allow confirmation only when reservation status is confirmed.",
    policy: {
      id: "confirm_active_reservation",
      action: "confirm",
      requires: [{ fact: "reservationStatus", op: "eq", value: "confirmed" }],
      forbids: [],
    },
  },
  {
    eilCategory: "hospitality",
    category: "reservations",
    id: "no_confirm_cancelled",
    namePt: "Não confirmar reserva cancelada",
    nameEn: "Do not confirm cancelled reservation",
    descriptionPt: "Bloqueia confirmação quando a reserva está cancelada.",
    descriptionEn: "Block confirmation when reservation is cancelled.",
    policy: {
      id: "no_confirm_cancelled",
      action: "confirm",
      forbids: [{ fact: "reservationStatus", op: "eq", value: "cancelled" }],
      requires: [],
    },
  },
  {
    eilCategory: "hospitality",
    category: "security",
    id: "ask_document_when_needed",
    namePt: "Solicitar documento apenas quando necessário",
    nameEn: "Request document only when needed",
    descriptionPt: "Solicita documento somente se ainda não foi informado.",
    descriptionEn: "Request document only if not yet provided.",
    policy: {
      id: "ask_document_when_needed",
      action: "ask_document",
      requires: [{ fact: "documentNumber", op: "not_exists" }],
      forbids: [],
    },
  },
  {
    eilCategory: "hospitality",
    category: "payments",
    id: "ask_payment_when_allowed",
    namePt: "Solicitar pagamento somente quando permitido",
    nameEn: "Request payment only when allowed",
    descriptionPt: "Solicita pagamento apenas quando o status indica pendência.",
    descriptionEn: "Request payment only when status indicates pending.",
    policy: {
      id: "ask_payment_when_allowed",
      action: "ask_payment",
      requires: [{ fact: "paymentStatus", op: "eq", value: "pending" }],
      forbids: [],
    },
  },
  {
    eilCategory: "hospitality",
    category: "operations",
    id: "complete_flow_requirements",
    namePt: "Finalizar atendimento somente após requisitos",
    nameEn: "Complete flow only after requirements",
    descriptionPt: "Permite finalizar somente quando o check-in está concluído.",
    descriptionEn: "Allow completion only when check-in is done.",
    policy: {
      id: "complete_flow_requirements",
      action: "complete_flow",
      requires: [{ fact: "checkinStatus", op: "eq", value: "completed" }],
      forbids: [],
    },
  },
  {
    eilCategory: "ecommerce",
    category: "operations",
    id: "no_cancel_shipped",
    namePt: "Não cancelar pedido após envio",
    nameEn: "Do not cancel order after shipping",
    descriptionPt: "Bloqueia cancelamento quando o pedido já foi enviado.",
    descriptionEn: "Block cancellation when order is already shipped.",
    policy: {
      id: "no_cancel_shipped",
      action: "cancel_order",
      forbids: [{ fact: "orderStatus", op: "eq", value: "shipped" }],
      requires: [],
    },
  },
  {
    eilCategory: "ecommerce",
    category: "operations",
    id: "request_address_before_delivery",
    namePt: "Solicitar endereço antes de calcular entrega",
    nameEn: "Request address before delivery estimate",
    descriptionPt: "Exige endereço informado antes de consultar entrega.",
    descriptionEn: "Require address before checking delivery.",
    policy: {
      id: "request_address_before_delivery",
      action: "consult_delivery",
      requires: [{ fact: "deliveryAddress", op: "exists" }],
      forbids: [],
    },
  },
  {
    eilCategory: "ecommerce",
    category: "payments",
    id: "confirm_payment_when_approved",
    namePt: "Confirmar pagamento somente quando aprovado",
    nameEn: "Confirm payment only when approved",
    descriptionPt: "Permite confirmar pagamento apenas após aprovação.",
    descriptionEn: "Allow payment confirmation only after approval.",
    policy: {
      id: "confirm_payment_when_approved",
      action: "confirm_payment",
      requires: [{ fact: "paymentStatus", op: "eq", value: "approved" }],
      forbids: [],
    },
  },
  {
    eilCategory: "saas",
    category: "security",
    id: "auth_before_account_change",
    namePt: "Solicitar autenticação antes de alterar conta",
    nameEn: "Require authentication before account change",
    descriptionPt: "Exige identificação confirmada antes de alterações na conta.",
    descriptionEn: "Require confirmed identity before account changes.",
    policy: {
      id: "auth_before_account_change",
      action: "change_subscription",
      requires: [{ fact: "accountVerified", op: "eq", value: true }],
      forbids: [],
    },
  },
  {
    eilCategory: "saas",
    category: "operations",
    id: "no_cancel_subscription_without_confirm",
    namePt: "Não cancelar assinatura sem confirmação",
    nameEn: "Do not cancel subscription without confirmation",
    descriptionPt: "Bloqueia cancelamento sem confirmação explícita do cliente.",
    descriptionEn: "Block cancellation without explicit customer confirmation.",
    policy: {
      id: "no_cancel_subscription_without_confirm",
      action: "cancel_subscription",
      requires: [{ fact: "subscriptionConfirmed", op: "eq", value: true }],
      forbids: [],
    },
  },
];
