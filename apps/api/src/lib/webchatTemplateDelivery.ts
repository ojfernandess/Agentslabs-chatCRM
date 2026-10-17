import { extractBodyPlaceholdersInOrder } from "./templateVariables.js";

/** Sufixo dinâmico de {{webchat}} em https://dominio/{{webchat}} → s/<token>. */
export function webchatTemplateSuffix(token: string): string {
  return `s/${encodeURIComponent(token)}`;
}

/**
 * Monta os components Meta do envio opcional por template.
 * O botão de URL recebe o sufixo. O corpo só é preenchido quando a variável é {{webchat}} ou um único {{1}}.
 */
export function buildWebchatTemplateComponents(
  body: string,
  suffix: string,
): Array<Record<string, unknown>> {
  const tokens = extractBodyPlaceholdersInOrder(body);
  const components: Array<Record<string, unknown>> = [];

  if (tokens.length > 0) {
    const named = tokens.some((token) => !/^\d+$/.test(token));
    if (named) {
      const foreign = tokens.find((token) => token.toLowerCase() !== "webchat");
      if (foreign) {
        throw new Error(
          `Template body variable {{${foreign}}} is not supported. Use only {{webchat}}.`,
        );
      }
      components.push({
        type: "body",
        parameters: tokens.map(() => ({
          type: "text",
          text: suffix,
          parameter_name: "webchat",
        })),
      });
    } else {
      const max = tokens.reduce((acc, token) => Math.max(acc, parseInt(token, 10) || 0), 0);
      if (max !== 1) {
        throw new Error("Template body must use only {{webchat}} or a single {{1}}.");
      }
      components.push({
        type: "body",
        parameters: [{ type: "text", text: suffix }],
      });
    }
  }

  components.push({
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [{ type: "text", text: suffix }],
  });
  return components;
}

/** Valores do corpo, na ordem exigida por deliverOutboundWhatsAppMessage. */
export function webchatTemplateBodyParameters(body: string, suffix: string): string[] {
  const tokens = extractBodyPlaceholdersInOrder(body);
  if (tokens.length === 0) return [];
  return tokens.map(() => suffix);
}
