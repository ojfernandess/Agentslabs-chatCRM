export function mapNvoipTestErrorMessage(message: string, t: (key: string) => string): string {
  if (message === "nvoip_api_unreachable" || message.startsWith("nvoip_api_html_response")) {
    return t("nvoip.testErrorApiUnreachable");
  }
  if (message === "nvoip_balance_unavailable") {
    return t("nvoip.testErrorApiUnreachable");
  }
  if (message === "nvoip_oauth_forbidden" || message.toLowerCase() === "forbidden") {
    return t("nvoip.testErrorForbidden");
  }
  return message;
}
