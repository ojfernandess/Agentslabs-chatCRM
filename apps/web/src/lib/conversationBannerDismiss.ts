const PREFIX = "openconduit_conv_banner_dismiss_";
const USER_PREFIX = "openconduit_user_banner_dismiss_";

export type ConversationBannerKey = "awaiting_human" | "bot_triage";
export type UserBannerKey = "composer_signature";

function conversationStorageKey(conversationId: string, key: ConversationBannerKey): string {
  return `${PREFIX}${conversationId}_${key}`;
}

export function isConversationBannerDismissed(conversationId: string, key: ConversationBannerKey): boolean {
  try {
    return sessionStorage.getItem(conversationStorageKey(conversationId, key)) === "1";
  } catch {
    return false;
  }
}

export function dismissConversationBanner(conversationId: string, key: ConversationBannerKey): void {
  try {
    sessionStorage.setItem(conversationStorageKey(conversationId, key), "1");
  } catch {
    /* ignore */
  }
}

export function isUserBannerDismissed(key: UserBannerKey): boolean {
  try {
    return localStorage.getItem(`${USER_PREFIX}${key}`) === "1";
  } catch {
    return false;
  }
}

export function dismissUserBanner(key: UserBannerKey): void {
  try {
    localStorage.setItem(`${USER_PREFIX}${key}`, "1");
  } catch {
    /* ignore */
  }
}
