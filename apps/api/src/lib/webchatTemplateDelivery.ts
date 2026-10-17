import { extractBodyPlaceholdersInOrder } from "./templateVariables.js";

/**
 * Valor de {{webchat}} em https://dominio/{{webchat}}.
 * A Meta rejeita barra, quebra de linha e o nome ausente no botão (erro 132018).
 */
export function webchatTemplateSuffix(token: string): string {
  return token.trim();
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
    parameters: [{ type: "text", text: suffix, parameter_name: "webchat" }],
  });
  return components;
}

/** Valores do corpo, na ordem exigida por deliverOutboundWhatsAppMessage. */
export function webchatTemplateBodyParameters(body: string, suffix: string): string[] {
  const tokens = extractBodyPlaceholdersInOrder(body);
  if (tokens.length === 0) return [];
  return tokens.map(() => suffix);
}
