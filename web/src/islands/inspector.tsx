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
  // Variables start collapsed and Properties expanded; with nothing selected Properties shows the page settings.
  // The user can still toggle either; the automatic state is re-applied when the selection empties or fills.
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  useEffect(() => {
    setVariablesOpen(false);
    setPropertiesOpen(true);
  }, [selected]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-xs text-foreground-2">
      <PanelHeader />
      <VariablesSection
        open={variablesOpen}
        onToggle={() => setVariablesOpen(!variablesOpen)}
        grow={!propertiesOpen}
      />
      <section
        id="insp-properties"
        aria-label="Properties"
        className={cn(
          "flex min-h-0 flex-col",
          propertiesOpen ? "flex-1" : "shrink-0 border-b border-divider",
        )}
      >
        <PanelSectionHeader
          label="Properties"
          open={propertiesOpen}
          onToggle={() => setPropertiesOpen(!propertiesOpen)}
        />
        <div
          hidden={!propertiesOpen}
          data-scroll
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <PropertiesBody doc={doc} node={node} selection={selection} />
        </div>
      </section>
    </div>
  );
}

mountIsland("inspector", setupInspector, () => <Island />);
