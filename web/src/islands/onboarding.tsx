// Island entry: onboarding. First-run setup of the desktop app (not a tutorial): a Verynize
// account, then the coding agents chats run on. Shown once per profile; skipped in the plain web
// build and in automated runs (desktop onboardingState().skip, VERYNIZE_SKIP_ONBOARDING=1).
import { useEffect, useState } from "react";
import { mountIsland, ensureContainer } from "@/lib/mount";
import { cloudAccount } from "@/lib/cloud-account";
import { AccountStep } from "./onboarding/account-step";
import { AgentsStep } from "./onboarding/agents-step";
import "./onboarding/onboarding.css";
import { can, platform } from "@/lib/platform";

const DONE_KEY = "verynize.onboarding";
type Step = "account" | "agents" | "done";

const finished = () => {
  try {
    return localStorage.getItem(DONE_KEY) === "done";
  } catch {
    return true;
  }
};

function Onboarding() {
  const [step, setStep] = useState<Step | null>(null);
  useEffect(() => {
    const desktop = platform.desktop;
    if (!desktop || !can("onboarding")) return setStep("done");
    // "Sign in" entries (workspace switcher, Settings) open it again at any time.
    const reopen = () => setStep(cloudAccount()?.get() ? "agents" : "account");
    window.addEventListener("bd:open-onboarding", reopen);
    if (finished()) setStep("done");
    else
      desktop.onboardingState().then(
        ({ skip }) => setStep(skip ? "done" : cloudAccount()?.get() ? "agents" : "account"),
        () => setStep("done"),
      );
    return () => window.removeEventListener("bd:open-onboarding", reopen);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("onboarding-open", step === "account" || step === "agents");
  }, [step]);

  if (!step || step === "done") return null;
  const finish = () => {
    try {
      localStorage.setItem(DONE_KEY, "done");
    } catch {}
    setStep("done");
  };
  return (
    <div
      id="onboarding"
      data-step={step}
      role="dialog"
      aria-modal="true"
      aria-label={step === "account" ? "Set up your account" : "Connect your agents"}
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
    >
      <div data-drag="" className="h-chrome shrink-0" />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-chrome">
        {step === "account" ? (
          <AccountStep onDone={() => setStep("agents")} />
        ) : (
          <AgentsStep onContinue={finish} />
        )}
      </div>
      <div className="flex justify-center gap-1.5 pb-6" role="list" aria-label="Setup steps">
        {(["account", "agents"] as const).map((id) => (
          <span
            key={id}
            role="listitem"
            aria-current={id === step ? "step" : undefined}
            className={
              id === step
                ? "size-1.5 rounded-full bg-foreground"
                : "size-1.5 rounded-full bg-accent"
            }
          />
        ))}
      </div>
    </div>
  );
}

mountIsland(
  "onboarding",
  () => ensureContainer("bd-onboarding-root"),
  () => <Onboarding />,
);
