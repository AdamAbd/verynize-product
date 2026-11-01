import { createFileRoute } from "@tanstack/react-router";

// /settings opens the default section (rendered by the settings layout, settings.tsx); the shell router replaces the
// URL with /settings/<section>.
export const Route = createFileRoute("/_editor/settings/")({});
