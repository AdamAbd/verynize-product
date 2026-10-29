// Class names that are part of the test / legacy contract (`.layer-row.is-hidden`, `.app-menu-trigger`, …).
// They are not Tailwind utilities, so they are kept out of Tailwind class strings.
export function contract(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
