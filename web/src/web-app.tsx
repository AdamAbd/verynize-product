// Web entry (TanStack Start, web-start/): the same islands as ui.tsx, bundled into Start's client build from source
// (`virtual:verynize/legacy-ui`, web-start/build/legacy-web.mjs) instead of the web/dist/ui.js IIFE, so Start's
// routes and the islands share one React, one QueryClient and one TanStack Router. Also exports the areas Start's
// routes render themselves. Desktop keeps loading web/dist/ui.js (ui.tsx).
import * as React from "react";
import "./ui";

export { islandsCommitted } from "./lib/bridge";
export { HomeArea } from "./islands/home/route-area";
export { SettingsArea } from "./islands/settings/route-area";
/** Lets the web app check that its React and the islands' React are one copy. */
export { React };
