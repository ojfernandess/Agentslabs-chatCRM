/**
 * Detecção de turnos C13 / pedido de humano — usado pelo Scheduler (runtime_owned),
 * planner de intenção e política de turno. Não substitui o playbook; garante que
 * `call_human` / `transfer_to_team` do prompt sejam executados via Tool Scheduler.
 */

/** Reclamação operacional (quarto sujo, quebrado, etc.) — C13 fase de coleta ou escalonamento. */
export function messageLooksLikeOperationalComplaint(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  return (
    /\b(reclam|reclama[cç][aã]o|insatisfeit|p[eé]ssim|irritad|impacient|indignad)\b/i.test(t) ||
    /\b(quarto|su[ií]te|banheiro|ar[\s-]?condicionado|tv|caf[eé]|toalha|len[cç][oó]l)\b[\s\S]{0,40}\b(suj\w*|quebrad\w*|estragad\w*|n[aã]o funciona|com defeito|vazando|barulho|fedor|mofad\w*)\b/i.test(
      t,
    ) ||
    /\b(suj\w*|quebrad\w*|estragad\w*|n[aã]o funciona|com defeito|vazando)\b[\s\S]{0,40}\b(quarto|su[ií]te|banheiro|tv|caf[eé])\b/i.test(
      t,
    ) ||
    /\bmau atendimento\b/i.test(t)
  );
}

/** Pedido explícito de atendimento humano. */
export function messageLooksLikeHumanHandoffRequest(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  return (
    /\bfalar com (?:um )?(?:humano|atendente|atendimento|pessoa|gente)\b/i.test(t) ||
    /\bfalar com\b[\s\S]{0,80}\b(?:time|equipe)\s+de\s+atendimento\b/i.test(t) ||
    /\b(?:gostaria|quero|preciso)\s+(?:de\s+)?falar\s+com\b/i.test(t) ||
    /\bquero (?:um )?(?:humano|atendente|atendimento|pessoa)\b/i.test(t) ||
    /\b(?:me )?(?:transfere|transfer[ei]|encaminh)[ae]?\b[\s\S]{0,40}\b(?:humano|atendente|atendimento|equipe)\b/i.test(
      t,
    ) ||
    /\bpreciso falar com\b/i.test(t) ||
    /\batendimento humano\b/i.test(t)
  );
}

/** Pagamento/prazo/valor — C21, inclusive retomada fora de contexto (reserva via atendimento humano). */
export function messageLooksLikeReservationPaymentOperational(
  userMessage?: string | null,
): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  if (
    /\bpagament/i.test(t) &&
    (/\bR\$\s*[\d.,]+/i.test(t) ||
      /\bser[aá]\s+feito\s+hoje\b/i.test(t) ||
      /\bhoje\s+tamb[eé]m\b/i.test(t) ||
      /\bvalor\b/i.test(t))
  ) {
    return true;
  }
  if (/\b(?:realizar|fazer|efetuar)\s+(?:o\s+)?pagament/i.test(t)) return true;
  if (/\b(?:segurar|prorrogar|manter)\b[\s\S]{0,40}\b(?:di[aá]ria|reserva|prazo)\b/i.test(t)) {
    return true;
  }
  if (/\b(?:bloqueio|cancelament).*\breserva\b/i.test(t)) return true;
  if (/\bj[aá]\s+paguei\b/i.test(t)) return true;
  return false;
}

/** Pedido operacional de estadia (troca de quarto, etc.) — handoff humano. */
export function messageLooksLikeStayOperationalRequest(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  return (
    /\btrocar de quarto\b/i.test(t) ||
    /\btroca de quarto\b/i.test(t) ||
    /\bmudar de quarto\b/i.test(t)
  );
}

export function messageLooksLikeEscalationTurn(userMessage?: string | null): boolean {
  return (
    messageLooksLikeHumanHandoffRequest(userMessage) ||
    messageLooksLikeOperationalComplaint(userMessage) ||
    /\breclam|irritad|p[eé]ssim\b/i.test((userMessage ?? "").trim())
  );
}

/** Última msg do agente pediu dados para reclamação (C13 coleta). */
export function assistantIsComplaintDataCollection(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return (
    /sinto muito/i.test(t) &&
    /(?:hospedagem|unidade|quarto|localizador|n[uú]mero do quarto)/i.test(t)
  );
}

/** Hóspede informou unidade e/ou quarto após coleta C13. */
export function guestProvidesComplaintContext(userMessage?: string | null): boolean {
  const msg = (userMessage ?? "").trim();
  if (!msg) return false;
  const hasRoom =
    /\bquarto\s*#?\s*\d+\b/i.test(msg) ||
    /\bquarto\s+\d+\b/i.test(msg) ||
    /\bsu[ií]te\s+\d+\b/i.test(msg) ||
    /\b(?:n[uú]mero|num\.?)\s*(?:do\s+)?quarto\s*#?\s*\d+/i.test(msg);
  const hasEstablishment =
    /\b(?:audaar|hotel|club|suites|brooklin|rock|blue ocean|hospedagem|unidade)\b/i.test(msg);
  return hasRoom || (hasEstablishment && /\bquarto\b|\d{1,4}\b/i.test(msg));
}

/** Turno em que o Scheduler deve executar `call_human` (C13 / pedido humano). */
export function shouldRequireCallHumanThisTurn(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
}): boolean {
  const msg = (opts.userMessage ?? "").trim();
  if (!msg) return false;
  if (messageLooksLikeHumanHandoffRequest(msg)) return true;
  if (messageLooksLikeReservationPaymentOperational(msg)) return true;
  if (messageLooksLikeStayOperationalRequest(msg)) return true;
  if (
    assistantIsComplaintDataCollection(opts.lastAssistantMessage) &&
    guestProvidesComplaintContext(msg)
  ) {
    return true;
  }
  if (
    messageLooksLikeOperationalComplaint(msg) &&
    /\b(irritad|impacient|agora|j[aá]|urgente|imediato)\b/i.test(msg)
  ) {
    return true;
  }
  return false;
}

/** Resposta afirma transferência/encaminhamento ao humano. */
export function replyClaimsHumanTransfer(text?: string | null): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    /\b(transferi\w*|encaminh\w*|vou transferir|equipe de atendimento dar[aá] continuidade)\b/i.test(t) ||
    (/\btransferir\b/i.test(t) && /\batendimento|equipe|humano\b/i.test(t))
  );
}
