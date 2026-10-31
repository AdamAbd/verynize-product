import { createFileRoute } from "@tanstack/react-router";

// The desktop page was index.html; old links keep working. Browsers carry the fragment
// (#room=…, #public=…) across the redirect.
export const Route = createFileRoute("/index.html")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        return Response.redirect(new URL("/" + url.search, url), 302);
      },
    },
  },
});
