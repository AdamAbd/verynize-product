// Production entry: every island in one bundle so React, Radix and the design tokens load once.
// Islands can still be built alone for development: node scripts/build-ui.cjs <area>
import "./islands/chrome";
import "./islands/sidebar";
import "./islands/inspector";
import "./islands/home";
import "./islands/chat";
import "./islands/settings";
import "./islands/code";
import "./islands/onboarding";

import "./islands/router";
