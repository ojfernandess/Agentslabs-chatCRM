import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";

export type ClientOutboundTokenStream = {
  onTokenDelta: (delta: string) => void;
  finish: () => Promise<{ deliveredText: string; chunkCount: number; firstChunkMs: number | null }>;
};

type DeliverChunkFn = (chunk: string) => Promise<void>;

/**
 * Envia chunks de texto ao contacto durante geração LLM (WhatsApp / canais outbound).
 * WhatsApp não suporta edição token-a-token — flush por blocos em fronteiras de palavra.
 */
export function createClientOutboundTokenStream(params: {
  organizationId: string;
  botId: string;
  conversationId: string;
  contactId: string;
  log: FastifyBaseLogger;
  minChunkChars?: number;
  chunkDelayMs?: number;
  /** Injecção para testes — default envia via WhatsApp outbound. */
  deliverChunk?: DeliverChunkFn;
}): ClientOutboundTokenStream {
  let buffer = "";
  let deliveredText = "";
  let chunkCount = 0;
  let firstChunkMs: number | null = null;
  const startedAt = Date.now();
  let flushChain: Promise<void> = Promise.resolve();
  const minChars = params.minChunkChars ?? config.clientOutboundStreamMinChunkChars;
  const chunkDelayMs = params.chunkDelayMs ?? config.clientOutboundStreamChunkDelayMs;

  const deliverChunk: DeliverChunkFn =
    params.deliverChunk ??
    (async (chunk) => {
      await deliverOutboundWhatsAppMessage({
        organizationId: params.organizationId,
        data: {
          contactId: params.contactId,
          conversationId: params.conversationId,
          type: "TEXT",
          body: chunk,
        },
        actor: { kind: "agent_bot", botId: params.botId },
        log: params.log,
        newConversation: { status: "PENDING", assignedToId: null },
      });
    });

  const flushChunk = async (text: string): Promise<void> => {
    const chunk = text.trim();
    if (!chunk) return;
    if (chunkCount > 0 && chunkDelayMs > 0) {
      await new Promise((r) => setTimeout(r, chunkDelayMs));
    }
    await deliverChunk(chunk);
    if (firstChunkMs == null) firstChunkMs = Date.now() - startedAt;
    deliveredText += (deliveredText ? "\n" : "") + chunk;
    chunkCount += 1;
  };

  const scheduleFlush = (force: boolean): void => {
    if (!force && buffer.length < minChars) return;
    let cut = buffer.length;
    if (!force) {
      const lastSpace = buffer.lastIndexOf(" ", minChars);
      if (lastSpace < minChars / 2) return;
      cut = lastSpace;
    }
    const chunk = buffer.slice(0, cut);
    buffer = buffer.slice(cut).trimStart();
    if (!chunk.trim()) return;
    flushChain = flushChain.then(() => flushChunk(chunk)).catch((err) => {
      params.log.warn({ err, botId: params.botId }, "client outbound token stream chunk failed");
    });
  };

  return {
    onTokenDelta(delta: string) {
      if (!delta) return;
      buffer += delta;
      scheduleFlush(false);
    },
    async finish() {
      scheduleFlush(true);
      if (buffer.trim()) {
        flushChain = flushChain.then(() => flushChunk(buffer)).catch((err) => {
          params.log.warn({ err, botId: params.botId }, "client outbound token stream final flush failed");
        });
        buffer = "";
      }
      await flushChain;
      if (chunkCount > 0) {
        params.log.info(
          {
            botId: params.botId,
            conversationId: params.conversationId,
            chunkCount,
            firstChunkMs,
            deliveredChars: deliveredText.length,
          },
          "client outbound stream completed",
        );
      }
      return { deliveredText, chunkCount, firstChunkMs };
    },
  };
}
