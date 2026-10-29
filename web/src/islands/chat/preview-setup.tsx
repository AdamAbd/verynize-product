import { useEffect, useState } from "react";
import { PlayIcon, XIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { desktop, errorMessage, type PreviewProposal } from "../code/api";
import { formatCommand, parsePreviewCommand } from "../code/preview-command";
import { workspace, type ChatState } from "./store";

type CanvasPreview = {ensure(options: {root: string; name?: string; chatId?: string; url?: string}): unknown; show(url: string, options?: {root: string; name?: string; chatId?: string}): void};
const preview = () => (window as unknown as {livePreview?: CanvasPreview}).livePreview;

export function PreviewSetup({state}: {state: ChatState}) {
  const [proposal, setProposal] = useState<PreviewProposal | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => void desktop()?.devServer?.status().then(status => {
      if (alive) setProposal(status.root === state.activeRoot && (!status.proposal?.chatId || status.proposal.chatId === state.conversationId) ? status.proposal || null : null);
    }).catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 1200);
    const setup = () => {
      if (!state.activeRoot) return;
      workspace()?.openChat();
      workspace()?.attachText?.("preview", "Preview setup", `Inspect this repository's stack, package manager, install/setup requirements, development command and listening port. Use the project's actual tools (npm, Yarn, pnpm, Bun, Python or another runtime); never assume Vite+ is installed. For plain HTML without a package manifest, use an available Python interpreter with -u -m http.server and --bind 127.0.0.1; setup can be omitted. Use the propose_preview tool to propose Setup, Run and Port for my review. Do not start or configure the preview until I accept the proposal. Pass chatId ${JSON.stringify(state.conversationId)} and a short app name. The project root is ${JSON.stringify(state.activeRoot)}.`);
      workspace()?.queueMessage?.("Set up the Preview");
    };
    window.addEventListener("bd:setup-preview", setup);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("bd:setup-preview", setup); };
  }, [state.activeRoot, state.conversationId]);
  return proposal ? <ProposalCard key={proposal.id} proposal={proposal} state={state} onDismiss={() => setProposal(null)} /> : null;
}

function ProposalCard({proposal, state, onDismiss}: {proposal: PreviewProposal; state: ChatState; onDismiss(): void}) {
  const [edit, setEdit] = useState(false);
  const [setup, setSetup] = useState(formatCommand(proposal.setup));
  const [run, setRun] = useState(formatCommand(proposal.command));
  const [port, setPort] = useState(String(proposal.port));
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(!!proposal.saved);
  const dismiss = async () => {
    try { await desktop()?.devServer?.dismissProposal({root:proposal.root}); onDismiss(); }
    catch (e) { setError(errorMessage(e)); }
  };
  const save = async () => {
    const api = desktop()?.devServer;
    if (!api) return;
    setError("");
    try {
      const command = parsePreviewCommand(run);
      const setupArgs = setup.trim() ? parsePreviewCommand(setup) : undefined;
      if (!command.length) throw Error("Enter a run command.");
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw Error("Port must be between 1 and 65535.");
      setPhase("Saving configuration…");
      await api.configure({root:proposal.root, command, setup:setupArgs, url:`http://localhost:${port}/`});
      const details = {root:proposal.root, name:proposal.name || "App", chatId:state.conversationId || undefined};
      preview()?.ensure(details);
      workspace()?.setCodeMode?.(false);
      workspace()?.openChat();
      if (setupArgs) {
        setPhase("Setting up preview…");
        window.dispatchEvent(new CustomEvent("bd:preview-setup-state", {detail:{root:proposal.root,state:"setting-up",message:"Running setup command…"}}));
        const result = await api.setup({root:proposal.root});
        if (result.setup) setSetup(formatCommand(result.setup));
        if (result.exitCode !== 0) throw Error(result.output || "Setup failed. Edit the configuration and retry.");
      }
      setPhase("Starting preview…");
      window.dispatchEvent(new CustomEvent("bd:preview-setup-state", {detail:{root:proposal.root,state:"starting",message:"Waiting for your app…"}}));
      const status = await api.start({root:proposal.root});
      if (status.state === "failed" || status.state === "exited") throw Error(status.error || status.tail || "Preview failed to start.");
      if (workspace()?.getState().activeRoot !== proposal.root) throw Error("Repository changed. Your preview configuration was saved.");
      if (status.url && status.state === "running") preview()?.show(status.url, details);
      setSaved(true);
      await api.dismissProposal({root:proposal.root, saved:true});
    } catch (e) { setError(errorMessage(e)); window.dispatchEvent(new CustomEvent("bd:preview-setup-state", {detail:{root:proposal.root,state:"failed",message:errorMessage(e)}})); }
    finally { setPhase(""); }
  };
  if (saved) return <div className="mx-3 mb-3 flex items-center gap-2 text-sm text-muted-foreground"><PlayIcon className="size-4" />Preview setup <span>Saved</span><ChevronRightIcon className="size-3" /></div>;
  return <section id="preview-proposal" className="mx-3 mb-3 rounded-xl border border-card-border bg-settings p-4" aria-label="Proposed Preview configuration">
    <div className="flex items-start gap-3"><PlayIcon className="mt-1 size-4 shrink-0" /><div className="min-w-0 flex-1"><h3 className="text-sm font-medium">Proposed Preview configuration</h3><p className="mt-1 text-sm text-muted-foreground">The agent suggests how to run your app in the Preview.</p></div><Button variant="ghost" size="icon" aria-label="Dismiss preview proposal" disabled={!!phase} onClick={() => void dismiss()}><XIcon className="size-4" /></Button></div>
    <div className="mt-4 overflow-hidden rounded-lg bg-input">
      {([["Setup", setup, setSetup], ["Run", run, setRun], ["Port", port, setPort]] as const).map(([label,value,setValue]) => <label key={label} className="flex items-center gap-4 border-b border-card-border px-3 py-2 text-sm last:border-0"><span className="w-12 shrink-0 text-muted-foreground">{label}</span>{edit ? <Input aria-label={`Preview ${label}`} value={value} onChange={e => setValue(e.target.value)} disabled={!!phase} /> : <code className="min-w-0 flex-1 break-all">{value || "None"}</code>}</label>)}
    </div>
    {(phase || error) && <p role="status" className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{error || phase}</p>}
    <div className="mt-3 flex justify-end gap-2"><Button variant="outline" disabled={!!phase} onClick={() => setEdit(!edit)}>{edit ? "Done" : "Edit"}</Button><Button disabled={!!phase} onClick={() => void save()}>{phase || "Save & start preview"}</Button></div>
  </section>;
}
