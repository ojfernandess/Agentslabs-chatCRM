import type { WavoipDevice } from "@prisma/client";

export type WavoipSipInfo = {
  deviceId: string;
  deviceName: string;
  linkedPhone: string | null;
  sipEnabled: boolean;
  methods: {
    id: "token_trunk" | "wavoip_account";
    label: string;
    username: string;
    password: string;
    callerId: string;
    note: string;
  }[];
  docsUrl: string;
};

/** SIP auth per https://wavoip.gitbook.io/api/sip/autenticacao.md */
export function buildWavoipSipInfo(device: WavoipDevice, deviceToken: string): WavoipSipInfo {
  const callerId = device.linkedPhone?.trim() || "";
  return {
    deviceId: device.id,
    deviceName: device.name,
    linkedPhone: device.linkedPhone,
    sipEnabled: device.sipEnabled,
    methods: [
      {
        id: "token_trunk",
        label: "Token do dispositivo (tronco)",
        username: deviceToken,
        password: deviceToken,
        callerId: callerId || deviceToken,
        note:
          "Use o token como usuário, senha e CallerID. O CallerID deve coincidir com o número conectado no dispositivo.",
      },
      {
        id: "wavoip_account",
        label: "Conta Wavoip (painel)",
        username: "(ver painel do dispositivo → SIP)",
        password: "(ver painel do dispositivo → SIP)",
        callerId: callerId || "(número conectado no dispositivo)",
        note: "Credenciais completas disponíveis em app.wavoip.com/devices → menu SIP.",
      },
    ],
    docsUrl: "https://wavoip.gitbook.io/api/sip/autenticacao.md",
  };
}
