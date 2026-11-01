import { createFileRoute } from "@tanstack/react-router";

// The section is rendered by the settings layout (settings.tsx) from this route's param.
export const Route = createFileRoute("/_editor/settings/$section")({});
