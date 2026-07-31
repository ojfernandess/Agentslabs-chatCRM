import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assignConversationTeamForOrg } from "./conversationTeamAssignment.js";
import {
  recordNativeAgentTransferHandoff,
  type NativeHandoffToolName,
} from "./agentConversationHandoff.js";

export const transferToTeamBodySchema = z.object({
  teamId: z.string().uuid(),
  reason: z.string().max(2000).optional(),
});

export const callHumanBodySchema = z.object({
  teamId: z.string().uuid().optional(),
  reason: z.string().max(2000).optional(),
});

type HandoffLog = Pick<FastifyBaseLogger, "warn">;

export async function transferConversationToTeamForOrg(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    conversationId: string;
    teamId: string;
    reason?: string | null;
    userMessageSnippet?: string;
    toolName?: Extract<NativeHandoffToolName, "transfer_to_team" | "assign_team_to_conversation">;
    log?: HandoffLog;
  },
): Promise<
  | {
      ok: true;
      payload: {
        teamId: string | null;
        teamName: string | null;
        message: string;
      };
    }
  | { ok: false; status: 400 | 404; message: string }
> {
  const r = await assignConversationTeamForOrg(prisma, {
    organizationId: params.organizationId,
    conversationId: params.conversationId,
    body: { teamId: params.teamId, assignedToId: null },
  });
  if (!r.ok) {
    return { ok: false, status: r.error.status, message: r.error.message };
  }

  await prisma.conversation.update({
    where: { id: params.conversationId },
    data: { status: "OPEN", updatedAt: new Date() },
  });

  const toolName = params.toolName ?? "transfer_to_team";
  try {
    await recordNativeAgentTransferHandoff({
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      toolName,
      reason: params.reason ?? null,
      userMessageSnippet: (params.userMessageSnippet ?? "").trim(),
      teamName: r.payload.team?.name ?? null,
    });
  } catch (err) {
    params.log?.warn(
      { err, conversationId: params.conversationId },
      `recordNativeAgentTransferHandoff failed after ${toolName}`,
    );
  }

  return {
    ok: true,
    payload: {
      teamId: r.payload.teamId,
      teamName: r.payload.team?.name ?? null,
      message: "Conversa atribuída à equipa e aberta para atendentes humanos.",
    },
  };
}

export async function callHumanForConversationForOrg(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    conversationId: string;
    teamId?: string | null;
    reason?: string | null;
    userMessageSnippet?: string;
    log?: HandoffLog;
  },
): Promise<{
  ok: true;
  payload: {
    teamId: string | null;
    teamName: string | null;
    message: string;
  };
}> {
  let teamName: string | null = null;
  let teamId: string | null = null;

  if (params.teamId) {
    const r = await assignConversationTeamForOrg(prisma, {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      body: { teamId: params.teamId, assignedToId: null },
    });
    if (!r.ok) {
      params.log?.warn({ err: r.error }, "call_human team assign failed");
    } else {
      teamId = r.payload.teamId;
      teamName = r.payload.team?.name ?? null;
    }
  }

  await prisma.conversation.update({
    where: { id: params.conversationId },
    data: { status: "OPEN", assignedToId: null, updatedAt: new Date() },
  });

  try {
    await recordNativeAgentTransferHandoff({
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      toolName: "call_human",
      reason: params.reason ?? null,
      userMessageSnippet: (params.userMessageSnippet ?? "").trim(),
      teamName,
    });
  } catch (err) {
    params.log?.warn(
      { err, conversationId: params.conversationId },
      "recordNativeAgentTransferHandoff failed after call_human",
    );
  }

  return {
    ok: true,
    payload: {
      teamId,
      teamName,
      message: "Conversa aberta para atendimento humano.",
    },
  };
}
