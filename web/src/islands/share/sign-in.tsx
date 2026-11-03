// Signed out, sharing a local file needs an account (the room is created in a workspace): the popover asks to sign
// in, then runs the action that asked (invite, visibility, copy link).
import { useState, type FormEvent } from "react";
import { cloudAccount, openSignIn } from "@/lib/cloud-account";
import { cancelSignIn, setShareOpen, signedIn } from "./store";

const field =
  "h-7 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none placeholder:text-subtle-foreground focus:border-transparent focus:ring-2 focus:ring-share-focus";

export function SignInStep() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const api = cloudAccount();
    if (!api) return setError("Accounts are not available in this build.");
    setBusy(true);
    setError("");
    try {
      await api.signIn({ server: api.defaultServer(), email: email.trim(), password });
      signedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      id="share-sign-in"
      className="flex flex-col gap-2"
      onSubmit={(event) => void submit(event)}
    >
      <p className="m-0 text-sm leading-4 text-share-muted">
        Sign in to Verynize to share this file.
      </p>
      <input
        id="share-sign-in-email"
        type="email"
        autoComplete="email"
        aria-label="Email"
        placeholder="Email"
        value={email}
        disabled={busy}
        className={field}
        onChange={(event) => setEmail(event.target.value)}
      />
      <input
        id="share-sign-in-password"
        type="password"
        autoComplete="current-password"
        aria-label="Password"
        placeholder="Password"
        value={password}
        disabled={busy}
        className={field}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error && (
        <p role="alert" className="m-0 text-sm leading-4 text-share-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        aria-busy={busy || undefined}
        className="h-7 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary-hover focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
      >
        Sign in
      </button>
      <div className="flex items-center justify-between text-sm leading-4">
        <button
          type="button"
          className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => {
            setShareOpen(false);
            openSignIn();
          }}
        >
          Create an account
        </button>
        <button
          type="button"
          className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={cancelSignIn}
        >
          Back
        </button>
      </div>
    </form>
  );
}
