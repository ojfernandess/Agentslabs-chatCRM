import assert from "node:assert/strict";
import test from "node:test";
import {
  kbTextIndicatesNfProcedure,
  kbTextIndicatesReceiptOnlyNoNf,
  tryNfEstablishmentKbReply,
  replyLooksLikeNfDataFormWithLocator,
  buildReceiptMirrorFromUserSubmission,
  tryReceiptFormSubmissionReply,
} from "./nfFlowReply.js";

test("kbTextIndicatesReceiptOnlyNoNf detects Audaar policy", () => {
  assert.equal(
    kbTextIndicatesReceiptOnlyNoNf(
      "Audaar Tech Suites só gera recibo (locação de curto período) — não emite NF.",
    ),
    true,
  );
});

test("kbTextIndicatesNfProcedure detects NF form section", () => {
  const kb = `## Nota fiscal (NF)

Para emitir nota fiscal:
- Nome completo
- CPF ou CNPJ
- CEP
- Telefone`;
  assert.equal(kbTextIndicatesNfProcedure(kb), true);
});

test("tryNfEstablishmentKbReply returns receipt-only for Audaar Tech", () => {
  const reply = tryNfEstablishmentKbReply({
    userMessage: "udaar Tech Suites",
    lastAssistantMessage: `Para emitir a nota fiscal, informe qual unidade:

1️⃣ Audaar Tech Suites
7️⃣ Hotel Brooklin`,
    kbTool: {
      name: "buscar_conhecimento",
      ok: true,
      preview: "só gera recibo — não emite nota fiscal",
    },
  });
  assert.ok(reply);
  assert.match(reply!, /n[aã]o emite nota fiscal/i);
  assert.match(reply!, /recibo/i);
  assert.doesNotMatch(reply!, /localizador/i);
});

test("tryNfEstablishmentKbReply returns form without locator when KB has NF", () => {
  const kb = `## Nota fiscal (NF)

- Nome completo
- CPF ou CNPJ
- CEP
- Telefone`;
  const reply = tryNfEstablishmentKbReply({
    userMessage: "Hotel Brooklin",
    lastAssistantMessage: "Para emitir a nota fiscal, qual unidade? 1️⃣ ... 7️⃣ Hotel Brooklin",
    kbTool: { name: "buscar_conhecimento", ok: true, preview: kb },
    replyText: "Ok, vou ajudar com a nota fiscal.",
  });
  assert.ok(reply);
  assert.match(reply!, /Nome completo/i);
  assert.doesNotMatch(reply!, /localizador/i);
});

test("replyLooksLikeNfDataFormWithLocator detects old form model", () => {
  assert.equal(
    replyLooksLikeNfDataFormWithLocator(
      "Para emitir NF... Nome completo... localizador da reserva DE4KRMDP",
    ),
    true,
  );
});

test("buildReceiptMirrorFromUserSubmission builds PF mirror from emoji form", () => {
  const userMsg = `🏨 Nome da hospedagem: Audaar Tech Suites
🔢 Localizador da reserva:
🛏️ Quarto: 101
⏰ Check-in: 01/08/2026
⏰ Checkout: 05/08/2026`;
  const mirror = buildReceiptMirrorFromUserSubmission(userMsg, "Formulário recibo pessoa física");
  assert.ok(mirror);
  assert.match(mirror!, /Confira os dados para emissão do recibo \(pessoa física\)/i);
  assert.match(mirror!, /Audaar Tech Suites/);
  assert.match(mirror!, /não informado/);
  assert.match(mirror!, /101/);
});

test("tryReceiptFormSubmissionReply returns mirror after receipt form", () => {
  const lastAssistant = `Para emitir o recibo (pessoa física), preencha:

🏨 Nome da hospedagem:
🔢 Localizador da reserva (opcional):
🛏️ Quarto:
⏰ Check-in:
⏰ Checkout:`;
  const userMsg = `🏨 Nome da hospedagem: Audaar Tech Suites
🛏️ Quarto: 101
⏰ Check-in: 01/08/2026
⏰ Checkout: 05/08/2026`;
  const mirror = tryReceiptFormSubmissionReply({
    userMessage: userMsg,
    lastAssistantMessage: lastAssistant,
    replyText: "Vou consultar a base de conhecimento.",
  });
  assert.ok(mirror);
  assert.match(mirror!, /Confira os dados/i);
});
