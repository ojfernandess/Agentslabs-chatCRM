/** Variáveis suportadas em respostas prontas (substituídas ao inserir ou enviar). */
export const CANNED_ATTENDANT_NAME_VARIABLES = [
  "atendente",
  "nome_atendente",
  "attendant_name",
  "attendant.name",
] as const;

/** Tokens canónicos para inserção no editor (build). */
export const CANNED_VARIABLE_INSERT_OPTIONS = [
  { token: "{{atendente}}", labelKey: "settings.cannedVarAtendente" },
  { token: "{{nome_atendente}}", labelKey: "settings.cannedVarNomeAtendente" },
  { token: "{{attendant_name}}", labelKey: "settings.cannedVarAttendantName" },
] as const;

const ATTENDANT_NAME_PATTERN = new RegExp(
  `\\{\\{\\s*(?:${CANNED_ATTENDANT_NAME_VARIABLES.map((v) => v.replace(".", "\\.")).join("|")})\\s*\\}\\}`,
  "gi",
);

export function attendantDisplayName(user: {
  displayName?: string | null;
  name?: string | null;
} | null | undefined): string {
  return user?.displayName?.trim() || user?.name?.trim() || "";
}

/** Substitui variáveis de resposta pronta pelo valor do perfil do atendente actual. */
export function resolveCannedResponseVariables(
  content: string,
  user: { displayName?: string | null; name?: string | null } | null | undefined,
): string {
  const name = attendantDisplayName(user);
  return content.replace(ATTENDANT_NAME_PATTERN, name);
}
