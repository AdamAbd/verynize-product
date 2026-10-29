import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { desktop, errorMessage, type DevServerStatus } from "./api";

import { parsePreviewCommand, formatCommand } from "./preview-command";

export function PreviewConfiguration({ status, root, onClose, onStart }: {status: DevServerStatus | null; root: string; onClose(): void; onStart(): Promise<void>}) {
  const [setup, setSetup] = useState(formatCommand(status?.config?.setup));
  const [command, setCommand] = useState(formatCommand(status?.config?.command || status?.detected?.command));
  const [port, setPort] = useState(status?.config?.url ? new URL(status.config.url).port : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const save = async (start: boolean) => {
    const api = desktop()?.devServer;
    if (!api) return;
    setBusy(true);
    try {
      const argv = parsePreviewCommand(command);
      if (!argv.length) throw new Error("Enter a run command.");
      if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new Error("Port must be between 1 and 65535.");
      await api.configure({ root, command: argv, setup: setup.trim() ? parsePreviewCommand(setup) : undefined, url: port ? `http://localhost:${port}/` : undefined });
      if (start) {
        if (setup.trim()) {
          setMessage("Setting up your app…");
          const result = await api.setup({root});
          if (result.exitCode !== 0) throw new Error(result.output || "Setup failed. Check the setup command and retry.");
        }
        await onStart();
      }
      onClose();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Preview configuration</DialogTitle><DialogDescription>Choose how to run your local app. Commands run in this chat’s repository.</DialogDescription></DialogHeader>
      <label className="grid gap-2 text-sm">Setup<Input id="preview-setup-command" value={setup} onChange={e => setSetup(e.target.value)} placeholder="npm install (optional)" disabled={busy} /></label>
      <label className="grid gap-2 text-sm">Run<Input id="preview-run-command" value={command} onChange={e => setCommand(e.target.value)} placeholder="npm run dev" disabled={busy} /></label>
      <label className="grid gap-2 text-sm">Port<Input id="preview-port" value={port} onChange={e => setPort(e.target.value)} placeholder="Detect from app output" inputMode="numeric" disabled={busy} /></label>
      <p className="text-xs text-muted-foreground">Quote arguments containing spaces. Shell operators and environment assignments are not supported.</p>
      <p role="status" className="text-xs text-muted-foreground">{message}</p>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => void save(false)}>Save</Button><Button disabled={busy} onClick={() => void save(true)}>{busy ? "Preparing preview…" : "Save & start preview"}</Button></div>
    </DialogContent>
  </Dialog>;
}
