import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEmbraturReferenceCatalog } from "./embraturReferenceCatalog.js";
import {
  hasCompleteEmbraturFields,
  resolveEmbraturSlotsForTravelForm,
} from "./embraturReferenceResolver.js";

const FORM_INGLATERRA = `* Motivo da viagem: Saúde
* Meio de transporte: Automóvel
* País de residência: Brasil
* País de destino: Inglaterra
* Cidade de procedência: São Paulo
* Cidade de destino: São Paulo`;

test("hasCompleteEmbraturFields accepts flat slots", () => {
  assert.equal(
    hasCompleteEmbraturFields({
      snmotvia: "7",
      sntiptran: "2",
      bgstdscpais: "1058",
      bgstdscpaisdest: "6289",
      snidcidadeibge: "3550308",
      snidcidadeibgedest: "3550308",
    }),
    true,
  );
});

test("resolveEmbraturSlotsForTravelForm uses invokeReference for missing pais (embratur_cb_country)", async () => {
  const catalog = parseEmbraturReferenceCatalog({
    motivosViagem: [{ id: 7, nome: "Saúde" }],
    meiosTransporte: [{ id: 2, nome: "Automóvel" }],
    paises: [{ id: "1058", nome: "Brasil" }],
    cidades: [{ id: 3550308, nome: "São Paulo" }],
  });

  const calls: Record<string, unknown>[] = [];
  const slots = await resolveEmbraturSlotsForTravelForm({
    userMessage: FORM_INGLATERRA,
    flowSlots: { __embraturReferenceCatalog: JSON.stringify(catalog) },
    invokeReference: async (args) => {
      calls.push(args);
      if (args.dominio === "embratur_cb_country" && !args.nome) {
        return {
          ok: true,
          structuredPayload: {
            dominio: "embratur_cb_country",
            dados: [
              { id: "1058", label: "Brasil" },
              { id: "6289", label: "Inglaterra" },
            ],
          },
        };
      }
      if (args.nome === "Inglaterra" || args.query === "Inglaterra") {
        return {
          ok: true,
          structuredPayload: {
            dominio: "embratur_cb_country",
            dados: [{ id: "6289", label: "Inglaterra" }],
          },
        };
      }
      return { ok: false };
    },
  });

  assert.equal(slots.snmotvia, "7");
  assert.equal(slots.bgstdscpaisdest, "6289");
  assert.ok(calls.some((c) => c.dominio === "embratur_cb_country"));
  assert.equal(hasCompleteEmbraturFields(slots as Record<string, unknown>), true);
});
