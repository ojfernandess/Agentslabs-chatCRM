export type ActiveVoiceCall = {
  provider: "wavoip" | "nvoip";
  conversationId: string;
  status: string;
  agent: { id: string; name: string } | null;
};
