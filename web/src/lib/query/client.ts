// The one QueryClient shared by every island (each island is its own React root, see mount.tsx),
// so a list fetched or invalidated in one island is current in all of them.
import { toast } from "sonner";
import { QueryClient } from "@tanstack/react-query";
import { currentScope, queryKeys, sameScope } from "./keys";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Same timing as the hand-rolled loaders this replaces: fetch on every mount and account
      // change, report errors at once, no background refetch on focus.
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Signing out or switching account/server drops everything cached for the previous identity.
let scope = currentScope();
window.addEventListener("cloud-account-changed", () => {
  const next = currentScope();
  if (sameScope(scope, next)) return;
  // A switch drops the previous scope; sign-out drops every cloud key.
  queryClient.removeQueries({
    queryKey: scope && next ? queryKeys.account(scope) : queryKeys.cloud(),
  });
  scope = next;
});

window.addEventListener("cloud-files-changed", () => {
  const scope = currentScope();
  if (scope)
    void queryClient.invalidateQueries({ queryKey: [...queryKeys.account(scope), "rooms"] });
});

declare global {
  interface Window {
    /** Test hook: the entries of the shared query cache (key, and whether it holds data). */
    __bdQueryCache?: () => { key: readonly unknown[]; data: boolean }[];
  }
}
window.__bdQueryCache = () =>
  queryClient
    .getQueryCache()
    .getAll()
    .map((query) => ({ key: query.queryKey, data: query.state.data !== undefined }));

window.addEventListener("account-sync-status", (event) => {
  const { error } = (event as CustomEvent<{ error: string }>).detail;
  if (error) toast.error(error, { id: "account-sync" });
  else toast.dismiss("account-sync");
});
