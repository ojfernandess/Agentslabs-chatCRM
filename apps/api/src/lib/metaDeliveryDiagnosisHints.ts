import { MessageDirection, MessageStatus, type Message, type MessageBillingLedgerEntry } from "@prisma/client";
import { isMetaMarketingFrequencyCapError } from "@openconduit/shared";
import { isMetaCloudWhatsappProvider } from "./whatsappWebhookVerify.js";

type ReplyTarget = {
  id: string;
  providerMsgId: string | null;
  direction: MessageDirection;
} | null;

export function diagnoseMetaDeliveryMessage(input: {
  message: Pick<
    Message,
    | "direction"
    | "status"
    | "providerMsgId"
    | "replyToMessageId"
    | "replyToExternalMsgId"
    | "isPrivate"
    | "channel"
    | "providerError"
  >;
  ledger: MessageBillingLedgerEntry | null | undefined;
  replyTo: ReplyTarget;
  inboxProvider: string | null;
}): { diagnosis: string[]; suggestedActions: string[] } {
  const diagnosis: string[] = [];
  const suggestedActions: string[] = [];

  if (input.message.isPrivate) {
    return {
      diagnosis: ["Nota interna — não foi enviada ao WhatsApp."],
      suggestedActions: [],
    };
  }

  if (input.message.channel === "WEBCHAT") {
    return {
      diagnosis: ["Entrega via Web Chat — não passa pela Meta Cloud API."],
      suggestedActions: [],
    };
  }

  if (!isMetaCloudWhatsappProvider(input.inboxProvider)) {
    if (input.inboxProvider) {
      diagnosis.push(`Provider da caixa: ${input.inboxProvider} — diagnóstico Meta Cloud focado em meta/360dialog.`);
    }
  }

  if (input.message.direction === MessageDirection.INBOUND) {
    return { diagnosis: ["Mensagem inbound — sem envio à Meta."], suggestedActions: [] };
  }

  if (
    input.message.status === MessageStatus.SENT ||
    input.message.status === MessageStatus.DELIVERED ||
    input.message.status === MessageStatus.READ
  ) {
    if (!input.message.providerMsgId) {
      diagnosis.push(
        "Status positivo sem wamid — raro; pode ser mensagem legada ou canal não-WhatsApp.",
      );
    }
    return { diagnosis, suggestedActions };
  }

  if (input.message.status !== MessageStatus.FAILED) {
    return { diagnosis, suggestedActions };
  }

  if (input.message.providerError?.trim()) {
    diagnosis.push(`Erro registado: ${input.message.providerError.trim()}`);
  }

  const ledger = input.ledger;

  if (ledger?.billingStatus === "BLOCKED" || ledger?.policyDecision === "BLOCKED_WINDOW") {
    diagnosis.push(
      `Bloqueado pela política de janela 24h${ledger.policyReason ? `: ${ledger.policyReason}` : ""}.`,
    );
    suggestedActions.push("Envie um template aprovado (HSM) para reabrir o atendimento fora da janela.");
    return { diagnosis, suggestedActions };
  }

  const marketingFrequencyCap = isMetaMarketingFrequencyCapError(input.message.providerError);

  const providerError = input.message.providerError?.trim() ?? "";
  const isNetworkError =
    /^META_NETWORK_ERROR:/i.test(providerError) || /\bfetch failed\b/i.test(providerError);
  const isConfigError = /^META_CONFIGURATION_ERROR:/i.test(providerError);
  const isApiError = /^META_API_ERROR:/i.test(providerError) || /^Meta API error:/i.test(providerError);
  const isMissingWamid = /^META_MISSING_MESSAGE_ID:/i.test(providerError);

  if (!input.message.providerMsgId) {
    if (isConfigError) {
      diagnosis.push("Erro de configuração do canal Meta — credenciais ou Phone Number ID inválidos/ausentes.");
      suggestedActions.push("Peça ao administrador para rever a integração WhatsApp Meta Cloud desta caixa.");
    } else if (isNetworkError) {
      diagnosis.push(
        "Erro de transporte (META_NETWORK_ERROR) — o servidor não conseguiu completar a chamada HTTPS à Meta.",
      );
      const causeMatch = providerError.match(/^META_NETWORK_ERROR:\s*(.+)$/i);
      if (causeMatch?.[1]) {
        diagnosis.push(`Causa registada: ${causeMatch[1]}`);
      }
      suggestedActions.push(
        "Reenvie a mensagem após alguns minutos — pode ser instabilidade temporária de rede ou DNS.",
      );
      suggestedActions.push(
        "Se persistir, verifique conectividade do servidor com graph.facebook.com (logs [META][SEND][NETWORK_ERROR]).",
      );
    } else if (isApiError) {
      diagnosis.push("A Meta respondeu com erro HTTP — a requisição chegou à API mas foi rejeitada.");
      suggestedActions.push("Revise token, permissões do app e parâmetros do envio no Business Manager.");
    } else if (isMissingWamid) {
      diagnosis.push(
        "A Meta respondeu HTTP 200 mas sem messages[0].id — resposta inesperada (META_MISSING_MESSAGE_ID).",
      );
    } else {
      diagnosis.push(
        "Envio falhou antes de obter wamid — consulte providerError e logs [META][SEND] no horário do envio.",
      );
      suggestedActions.push("Reenvie a mensagem — falhas transitórias costumam resolver no segundo envio.");
    }
    if (!isConfigError) {
      suggestedActions.push(
        "Verifique logs da API (Failed to send message via WhatsApp provider / [META][SEND]) para o detalhe técnico.",
      );
    }
  } else if (marketingFrequencyCap) {
    diagnosis.push(
      "Limite de frequência de marketing da Meta (código 131049) — o destinatário já recebeu muitos templates promocionais recentemente (de várias empresas).",
    );
    diagnosis.push(
      "A Meta aceitou o envio (wamid presente) mas recusou a entrega para proteger o ecossistema; não é bloqueio da sua conta nem falha do sistema.",
    );
    suggestedActions.push("Não reenvie o mesmo template de imediato — aguarde pelo menos 24 horas.");
    suggestedActions.push(
      "Se o conteúdo for transacional, use template Utility ou Authentication (não sujeitos a este limite).",
    );
    suggestedActions.push(
      "Peça ao contacto que envie uma mensagem (click-to-chat) para abrir a janela de 24h e continuar o atendimento.",
    );
  } else {
    diagnosis.push(
      "A Meta aceitou o envio (wamid presente) mas o webhook de status reportou FAILED posteriormente.",
    );
    diagnosis.push(
      "Causas frequentes: número inválido, utilizador bloqueou o negócio, conta Meta restrita ou recusa de entrega.",
    );
    suggestedActions.push("Confirme o número do contacto e se o hóspede ainda tem o WhatsApp activo.");
    suggestedActions.push("Consulte o Business Manager / qualidade do número na Meta.");
  }

  if (input.message.replyToMessageId || input.message.replyToExternalMsgId) {
    diagnosis.push("Mensagem enviada com citação (reply/context.message_id).");
    if (input.replyTo && !input.replyTo.providerMsgId) {
      diagnosis.push(
        "A mensagem citada não tem providerMsgId — a citação pode ter sido ignorada ou falhado silenciosamente.",
      );
    } else if (input.replyTo?.providerMsgId) {
      diagnosis.push(
        `Cita wamid ${input.replyTo.providerMsgId} — se Meta devolveu 400, o ID citado pode estar expirado ou inválido.`,
      );
      suggestedActions.push("Tente reenviar sem citação (resposta normal) para isolar o problema.");
    }
  }

  if (ledger?.failedAt) {
    diagnosis.push(`Ledger registou falha em ${ledger.failedAt.toISOString()}.`);
  }

  return { diagnosis, suggestedActions };
}
