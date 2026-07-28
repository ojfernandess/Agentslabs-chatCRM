/**
 * Native Prompt Assembly — blocos reutilizáveis extraídos do agentNativeLlm.
 * PromptCompiler consome contratos; este módulo monta appendix runtime (KB, tools, guards).
 */

export type KbToolPreambleOpts = {
  kbHasUsefulExcerpts: boolean;
  proactiveCoversQuery: boolean;
  allowedTagIds: string[];
  customToolPreamble: string;
};

/** Secção «Ferramentas (complemento)» conforme estado da KB proactiva. */
export function buildKbToolPreamble(opts: KbToolPreambleOpts): string {
  const { kbHasUsefulExcerpts, proactiveCoversQuery, allowedTagIds, customToolPreamble } = opts;
  const tagLines =
    allowedTagIds.length > 0
      ? "- `listar_etiquetas` / `atribuir_etiquetas`: atribua etiquetas ao contacto quando os critérios do prompt se aplicarem; use só UUIDs permitidos.\n"
      : "";

  if (kbHasUsefulExcerpts) {
    if (proactiveCoversQuery) {
      return (
        "\n\n### Ferramentas (complemento)\n" +
        "- **Base de conhecimento:** a secção acima **já contém excertos** recuperados para a última mensagem do cliente (pesquisa automática no servidor). Responda com factos concretos quando constarem aí.\n" +
        "- **PROIBIDO** como resposta final: frases de espera («um momento», «aguarde», «vou verificar») sem factos. Isso só pode ser aviso intermédio do sistema — a mensagem final tem de trazer a informação.\n" +
        "- **`buscar_conhecimento`:** no máximo **uma** chamada neste turno se o prompt exigir invocação explícita; depois responda ao cliente com os excertos (não repita a pesquisa).\n" +
        "- `transfer_to_team` / `listar_equipas`: apenas com UUID real de equipa.\n" +
        tagLines +
        "- `call_human`: apenas se o cliente pedir humano/atendente **ou** se os excertos / resultado da busca forem claramente insuficientes." +
        customToolPreamble
      );
    }
    return (
      "\n\n### Ferramentas (complemento)\n" +
      "- **Base de conhecimento:** há excertos proactivos acima, mas **podem não cobrir** totalmente a pergunta — use `buscar_conhecimento` se precisar de mais detalhe.\n" +
      "- **PROIBIDO** inventar factos (categorias, preços, horários, políticas) que não constem nos excertos ou no resultado da ferramenta.\n" +
      "- **`buscar_conhecimento`:** até **duas** chamadas neste turno; depois responda só com o que a base devolver.\n" +
      "- `transfer_to_team` / `listar_equipas`: apenas com UUID real de equipa.\n" +
      (allowedTagIds.length > 0
        ? "- `listar_etiquetas` / `atribuir_etiquetas`: atribua etiquetas ao contacto quando os critérios do prompt se aplicarem.\n"
        : "") +
      "- `call_human`: se, depois de `buscar_conhecimento`, a informação continuar insuficiente." +
      customToolPreamble
    );
  }

  return (
    "\n\n### Ferramentas (complemento)\n" +
    "- Use `buscar_conhecimento` para factos da organização antes de dizer que vai verificar — no máximo **duas** chamadas neste turno; depois responda.\n" +
    "- **PROIBIDO** como resposta final: frases de espera («um momento» / «vou verificar») sem dados da ferramenta.\n" +
    "- `transfer_to_team` / `listar_equipas`: use UUID real de equipa.\n" +
    (allowedTagIds.length > 0
      ? "- `listar_etiquetas` / `atribuir_etiquetas`: atribua etiquetas ao contacto quando as regras do agente o indicarem.\n"
      : "") +
    "- `call_human`: **apenas** se o cliente pedir humano/atendente **ou** se, depois de `buscar_conhecimento`, não for possível responder com verdade — **não** use para perguntas factuais que a base já cobre." +
    customToolPreamble
  );
}

export type ServerKbGuardOpts = {
  proactiveCoversQuery: boolean;
  kbHasUsefulExcerpts: boolean;
  customHttpToolCount: number;
};

/** Guards de precedência KB + hint de tools HTTP da organização. */
export function buildServerKbGuardBlock(opts: ServerKbGuardOpts): string {
  const kbGuard = opts.proactiveCoversQuery
    ? "\n\n[OpenConduit — precedência sobre instruções conflituantes no prompt do agente]\n" +
      "A secção «Base de conhecimento» acima contém o resultado da pesquisa automática para a última mensagem do cliente. " +
      "Se os excertos contiverem dados sobre o que foi perguntado, responda com esses dados de forma directa. " +
      "A função `buscar_conhecimento` pode ser usada no máximo uma vez neste turno se as suas regras exigirem chamada explícita; isso **não** significa que a primeira pesquisa «falhou». " +
      "**Não** invoque `call_human` nem `transfer_to_team` só porque o prompt do agente diz «se buscar_conhecimento falhar» quando já há excertos ou JSON útil com a resposta. " +
      "Use `call_human` só se o cliente pedir atendente/humano **ou** se, depois de usar excertos e/ou `buscar_conhecimento`, a informação continuar insuficiente. " +
      "Esta precedência **não** anula restrições do playbook do tipo «nunca informar X sem consultar a ferramenta» — nesse caso chame a tool indicada antes de afirmar dados."
    : opts.kbHasUsefulExcerpts
      ? "\n\n[OpenConduit — base de conhecimento parcial]\n" +
        "Há excertos proactivos acima, mas **podem não cobrir** totalmente a pergunta do cliente. " +
        "Use `buscar_conhecimento` se precisar de mais detalhe; **não invente** factos que não constem nos excertos ou no resultado da ferramenta."
      : "";

  const httpHint =
    opts.customHttpToolCount > 0
      ? "\n\n[OpenConduit — ferramentas HTTP da organização]\n" +
        "Existem funções com nome `oc_tool_` no catálogo: são integrações HTTP/Webhook configuradas para este agente. " +
        "Para consultas de reserva, estado de booking ou outros dados expostos por essas APIs, **chame primeiro** a função adequada com os argumentos do schema; só depois use `call_human` se a API falhar ou a resposta for insuficiente. " +
        "Respeite sempre as restrições e fluxos do playbook do agente ao decidir quando e como usar estas ferramentas."
      : "";

  return kbGuard + httpHint;
}
