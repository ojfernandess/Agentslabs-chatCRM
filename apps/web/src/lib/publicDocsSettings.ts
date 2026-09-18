export const PUBLIC_SYSTEM_DOCUMENTATION_SETTING_KEY = "public_system_documentation_enabled";

export type PublicDocsSectionVisibility = {
  conventions: boolean;
  auth: boolean;
  schemas: boolean;
  changelog: boolean;
  quickGuide: boolean;
  emailGuide: boolean;
  n8nGuide: boolean;
  postmanDownload: boolean;
  botAutomationNav: boolean;
};

export type PublicDocsAdminConfig = {
  enabled: boolean;
  sections: PublicDocsSectionVisibility;
  groups: Record<string, boolean>;
  availableGroups: { id: string; titlePt: string }[];
};
