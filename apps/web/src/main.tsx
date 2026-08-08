import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { I18nProvider } from "@/i18n/I18nProvider";
import { App } from "@/App";
import { initThemeFromStorage } from "@/lib/themeStorage";
import { initFontSizeFromStorage } from "@/lib/profilePrefs";
import { initDesktopViewportScale } from "@/lib/desktopViewportScale";
import { redirectLegacyInviteUrls } from "@/lib/inviteTokenRedirect";
import "./index.css";

redirectLegacyInviteUrls();
initThemeFromStorage();
initFontSizeFromStorage();
initDesktopViewportScale();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <I18nProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </I18nProvider>
  </BrowserRouter>,
);
