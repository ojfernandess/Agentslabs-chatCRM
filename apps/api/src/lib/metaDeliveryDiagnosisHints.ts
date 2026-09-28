import { MessageDirection, MessageStatus, type Message, type MessageBillingLedgerEntry } from "@prisma/client";
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

  if (!input.message.providerMsgId) {
    diagnosis.push(
      "Falha síncrona na API Meta — a chamada HTTP não devolveu wamid (providerMsgId vazio).",
    );
    diagnosis.push(
      "Causas frequentes: erro de rede transitório (fetch failed), timeout, Meta 400 (parâmetro inválido) ou credencial/token inválido.",
    );
    suggestedActions.push("Reenvie a mensagem — falhas transitórias costumam resolver no segundo envio.");
    suggestedActions.push(
      "Verifique logs da API no horário do envio (Failed to send message via WhatsApp provider) para o texto exacto do erro Meta.",
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
