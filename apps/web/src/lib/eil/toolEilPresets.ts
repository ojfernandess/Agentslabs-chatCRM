import type { ToolEilConfigDraft } from "./toolConfig.js";

/** Presets alinhados com DEFAULT_TOOL_EIL_BINDINGS do runtime (applyEilConfig). */
export const TOOL_EIL_NAME_PRESETS: Array<{ pattern: RegExp; eil: ToolEilConfigDraft }> = [
  {
    pattern: /consultar_reserva/i,
    eil: {
      produces: [
        "guestsQuantity",
        "reservationStatus",
        "checkinStatus",
        "localizadorOuReservationId",
        "reservationId",
      ],
      capabilities: ["lookup_reservation"],
      factPaths: {
        guestsQuantity: "stay.guestsQuantity",
        reservationStatus: "stay.status",
        checkinStatus: "stay.checkinStatus",
        localizadorOuReservationId: "stay.localizer",
        reservationId: "stay.reservationId",
      },
    },
  },
  {
    pattern: /consultar_main_guest|main_guest/i,
    eil: {
      produces: [
        "mainGuestId",
        "documentNumber",
        "email",
        "name",
        "phone",
        "mobilePhoneNumber",
        "found",
      ],
      capabilities: ["lookup_main_guest"],
      factPaths: {
        mainGuestId: "mainGuest.id",
        documentNumber: "mainGuest.documentNumber",
        email: "mainGuest.email",
        name: "mainGuest.name",
        phone: "mainGuest.mobilePhoneNumber",
        mobilePhoneNumber: "mainGuest.mobilePhoneNumber",
        found: "found",
      },
    },
  },
  {
    pattern: /check_in|checkin/i,
    eil: {
      produces: ["checkinCompleted", "reservationStatus"],
      requiresFacts: ["documentNumber", "email", "mainGuestId"],
      capabilities: ["complete_checkin"],
      factPaths: {
        checkinCompleted: "ok",
        reservationStatus: "status",
      },
    },
  },
  {
    pattern: /embratur|reference/i,
    eil: {
      produces: ["embraturReference", "travelMotives"],
      capabilities: ["lookup_embratur_reference"],
    },
  },
];
