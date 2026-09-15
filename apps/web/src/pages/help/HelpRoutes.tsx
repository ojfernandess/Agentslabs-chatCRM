import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

const HelpLayout = lazy(() => import("./HelpLayout").then((m) => ({ default: m.HelpLayout })));
const HelpHomePage = lazy(() => import("./HelpHomePage").then((m) => ({ default: m.HelpHomePage })));
const HelpContentResolver = lazy(() =>
  import("./HelpContentResolver").then((m) => ({ default: m.HelpContentResolver })),
);

function HelpLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
    </div>
  );
}

export function HelpRoutes() {
  return (
    <Suspense fallback={<HelpLoading />}>
      <Routes>
        <Route element={<HelpLayout />}>
          <Route index element={<HelpHomePage />} />
          <Route path="*" element={<HelpContentResolver />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
