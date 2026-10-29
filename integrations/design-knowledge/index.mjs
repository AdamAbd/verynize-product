// Verynize — design knowledge layer.
// Fundamentals, named style archetypes, domain playbooks, job-routed skills and the agent persona.

import { fundamentals } from './fundamentals.mjs';
import { archetypes, listArchetypes, getArchetype, pickArchetype, archetypeTokens, archetypeMarkdown } from './archetypes.mjs';
import { playbooks, getPlaybook, listPlaybooks, playbookMarkdown } from './playbooks.mjs';
import { skills, getSkill, listSkills } from './skills.mjs';
import { persona } from './persona.mjs';
import { contrastRatio, relativeLuminance } from './color.mjs';

/**
 * Guidelines for a design-context call. Fundamentals are always included.
 * @param {{ style?: string, domain?: string }} [options] style = archetype id or name; domain = playbook id or alias.
 * @returns {{ fundamentals: string, archetype?: string, playbook?: string, notes: string[] }} markdown strings.
 */
export function getDesignGuidelines({ style, domain } = {}) {
  const out = { fundamentals, notes: [] };
  if (style) {
    const a = getArchetype(style);
    if (a) out.archetype = archetypeMarkdown(a);
    else out.notes.push(`Unknown style "${style}". Available: ${archetypes.map(x => x.id).join(', ')}.`);
  }
  if (domain) {
    const p = getPlaybook(domain);
    if (p) out.playbook = playbookMarkdown(p);
    else out.notes.push(`Unknown domain "${domain}". Available: ${playbooks.map(x => x.id).join(', ')}.`);
  }
  if (!style) out.notes.push(`No style chosen. Pick one that fits the brief (pickArchetype suggests candidates) or follow the document's existing tokens. Styles: ${archetypes.map(x => x.id).join(', ')}.`);
  return out;
}

export {
  fundamentals,
  archetypes, listArchetypes, getArchetype, pickArchetype, archetypeTokens,
  playbooks, getPlaybook, listPlaybooks,
  skills, getSkill, listSkills,
  persona,
  contrastRatio, relativeLuminance,
};
