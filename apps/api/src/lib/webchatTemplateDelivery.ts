import type { MetaTemplateComponent } from "./metaWabaTemplates.js";
import { extractBodyPlaceholdersInOrder } from "./templateVariables.js";

/**
 * Valor de {{webchat}} em https://dominio/{{webchat}}.
 * A Meta rejeita barra, quebra de linha e o nome ausente no botão (erro 132018).
 */
export function webchatTemplateSuffix(token: string): string {
  return token.trim();
}

function textParameter(name: string, value: string): Record<string, unknown> {
  const parameter: Record<string, unknown> = { type: "text", text: value };
  if (!/^\d+$/.test(name)) parameter.parameter_name = name;
  return parameter;
}

/**
 * Preenche só os parâmetros que o modelo aprovado declara (corpo, cabeçalho ou botão de URL).
 * Não envia botão quando a variável está só no texto, nem o contrário.
 */
export function buildWebchatComponentsFromMetaDefinition(
  components: MetaTemplateComponent[] | null | undefined,
  value: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const component of components ?? []) {
    const type = String(component.type ?? "").toUpperCase();
    if (type === "HEADER") {
      const format = String(component.format ?? "TEXT").toUpperCase();
      if (format !== "TEXT") {
        throw new Error("This template has a media header. Use a text template with {{webchat}}.");
      }
      const tokens = extractBodyPlaceholdersInOrder(component.text ?? "");
      if (tokens.length === 0) continue;
      out.push({
        type: "header",
        parameters: tokens.map((name) => textParameter(name, value)),
      });
    }
    if (type === "BODY") {
      const tokens = extractBodyPlaceholdersInOrder(component.text ?? "");
      if (tokens.length === 0) continue;
      out.push({
        type: "body",
        parameters: tokens.map((name) => textParameter(name, value)),
      });
    }
    if (type === "BUTTONS") {
      (component.buttons ?? []).forEach((button, index) => {
        if (String(button.type ?? "").toUpperCase() !== "URL") return;
        const tokens = extractBodyPlaceholdersInOrder(button.url ?? "");
        if (tokens.length === 0) return;
        out.push({
          type: "button",
          sub_type: "url",
          index: String(index),
          parameters: [textParameter(tokens[0] ?? "1", value)],
        });
      });
    }
  }
  return out;
}

/**
 * Fallback quando a definição da Meta não pôde ser lida.
 * Se o corpo já tem variável, não inventa um botão. Se não tem, envia o botão {{webchat}}.
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

  if (tokens.length === 0) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [textParameter("1", suffix)],
    });
  }
  return components;
}

/** Valores do corpo, na ordem exigida por deliverOutboundWhatsAppMessage. */
export function webchatTemplateBodyParameters(body: string, suffix: string): string[] {
  const tokens = extractBodyPlaceholdersInOrder(body);
  if (tokens.length === 0) return [];
  return tokens.map(() => suffix);
}
