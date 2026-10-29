// Island entry: inspector. Owned by the "inspector" workstream (see web/src/islands/README.md).
// Renders the contents of `aside#properties`: header, Variables and Properties (design/wonder 11, 22, 25, 41–43).
import { useEffect, useLayoutEffect, useState } from "react";
import { mountIsland } from "@/lib/mount";
import { useDesign, useSelection } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { PanelHeader } from "./inspector/header";
import { detachLegacyForm, setupInspector } from "./inspector/legacy";
import { primaryNode } from "./inspector/model";
import { PropertiesBody } from "./inspector/properties";
import { PanelSectionHeader, VariablesSection } from "./inspector/variables";
import "./inspector/inspector.css";

function Island() {
  useLayoutEffect(detachLegacyForm, []);
  const doc = useDesign();
  const selection = useSelection();
  const node = primaryNode(doc, selection);
  const selected = !!node;
  // Wonder: with a selection, Variables collapse and Properties expand; without one, the reverse (11 / 22).
  // The user can still toggle either; the automatic state is re-applied when the selection empties or fills.
  const [variablesOpen, setVariablesOpen] = useState(!selected);
  const [propertiesOpen, setPropertiesOpen] = useState(selected);
  useEffect(() => {
    setVariablesOpen(!selected);
    setPropertiesOpen(selected);
  }, [selected]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-xs text-foreground-2">
      <PanelHeader />
      <VariablesSection open={variablesOpen} onToggle={() => setVariablesOpen(!variablesOpen)} grow={!propertiesOpen} />
      <section
        id="insp-properties"
        aria-label="Properties"
        className={cn("flex min-h-0 flex-col", propertiesOpen ? "flex-1" : "mt-auto shrink-0 border-t border-divider")}
      >
        <PanelSectionHeader
          label="Properties"
          open={propertiesOpen}
          onToggle={() => setPropertiesOpen(!propertiesOpen)}
        />
        <div hidden={!propertiesOpen} data-scroll className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <PropertiesBody doc={doc} node={node} selection={selection} />
        </div>
      </section>
    </div>
  );
}

mountIsland("inspector", setupInspector, () => <Island />);
