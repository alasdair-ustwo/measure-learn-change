// Builds data.js for index.html from saved eval results, so every number on
// the page comes from the results files rather than being typed by hand.
//
//   node build-data.mjs <path to packages/design-system/evals/results> <date-sha prefix>
//   node build-data.mjs ~/repos/design-system/packages/design-system/evals/results 2026-11-18-ace1d57
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [resultsDir, prefix] = process.argv.slice(2);
if (!resultsDir || !prefix) throw new Error('Pass the results directory and the file prefix');

const SETUPS = [
  { arm: 'baseline', name: 'No contracts, no skills', short: 'No contracts', highlight: false },
  { arm: 'contracts-only', name: 'Contracts', short: 'Contracts', highlight: false },
  { arm: 'with-skill', name: 'Contracts + skill + standards', short: 'Contracts + skill', highlight: true },
];

// Plain-English names for the spec rubric (evals/specs/Modal.rubric.md).
const GROUPS = [
  ['Anatomy', [
    ['ANAT-scrim', 'Scrim behind the dialog'],
    ['ANAT-surface', 'Raised surface with the lifted shadow'],
    ['ANAT-width', 'Fixed width per viewport (480 / 345)'],
    ['ANAT-container-tokens', 'Padding, radius and gap tokens'],
    ['ANAT-title', 'Title as h2 in heading/md'],
    ['ANAT-body', 'Optional body in body/lg'],
    ['ANAT-buttons', 'Reuses Button: secondary + primary, size lg'],
  ]],
  ['Layout', [
    ['LAYOUT-desktop', 'Desktop: right-aligned row, primary last'],
    ['LAYOUT-mobile', 'Mobile: full-width stack, primary first'],
    ['LAYOUT-viewport-prop', 'Layout set by an explicit viewport prop'],
    ['LAYOUT-no-truncation', 'Body text wraps, never truncates'],
  ]],
  ['Behaviour', [
    ['BEHAV-safe-dismiss', 'Escape, scrim and secondary all dismiss'],
    ['BEHAV-primary-only', 'Dismissing never fires the primary'],
    ['BEHAV-two-actions-max', 'At most two actions'],
    ['BEHAV-no-close-icon', 'No close icon'],
  ]],
  ['Accessibility', [
    ['A11Y-role', 'role="dialog" with aria-modal'],
    ['A11Y-name', 'Named by its title'],
    ['A11Y-description', 'Described by its body'],
    ['A11Y-initial-focus', 'Focus starts on the safe choice'],
    ['A11Y-focus-trap', 'Tab stays inside the dialog'],
    ['A11Y-focus-return', 'Focus returns to the opener'],
    ['A11Y-touch-target', '48px touch targets'],
  ]],
  ['Scope and docs', [
    ['SCOPE-only-spec-config', 'Only the props the spec defines'],
    ['SCOPE-tokens', 'Design tokens, no raw values'],
    ['DOCS-guidance', 'When to use and when not to, documented'],
    ['TEST-behaviour', 'Tests cover dialog behaviour'],
  ]],
];


// Blocker rules, from the standards the runs were graded against.
const standardsMd = readFileSync(join(resultsDir, '../../skills/_shared/standards.md'), 'utf8').split(/^<retired>$/m)[0];
const BLOCKERS = new Set(
  [...standardsMd.matchAll(/<rule id="([^"]+)" severity="blocker"/g)].map(([, id]) => id),
);

const round1 = (x) => Math.round(x * 1000) / 10;
const runsFor = (arm) =>
  JSON.parse(readFileSync(join(resultsDir, `${prefix}-${arm}-06-claude-sonnet-5-5.json`), 'utf8')).scores;

const setups = SETUPS.map((setup) => {
  const runs = runsFor(setup.arm);
  // Rules that need contracts are graded but not scored (see evals/judge.mts).
  const standardsItems = runs.map((r) =>
    (r.standards?.items ?? []).filter((i) => !(r.standards.unscored ?? []).includes(i.id)),
  );
  const contractItems = runs.map((r) =>
    (r.standards?.items ?? []).filter((i) => (r.standards.unscored ?? []).includes(i.id)),
  );
  return {
    ...setup,
    runs: runs.map((r) => round1(r.spec.score)),
    standards: runs.map((r) => (r.standards ? round1(r.standards.score) : null)),
    blockersBroken: standardsItems.map(
      (items) => items.filter((i) => BLOCKERS.has(i.id) && i.verdict === 'missed').length,
    ),
    contractRulesMet: contractItems.map((items) => items.filter((i) => i.verdict === 'met').length),
    contractRules: contractItems[0].length,
    specRead: `${runs.filter((r) => (r.figmaCalls ?? []).some((c) => c.endsWith(' 4:62'))).length}/${runs.length}`,
    cost: runs.map((r) => Math.round(r.costUsd * 100) / 100),
    passed: runs.filter((r) => r.tests && r.typecheck && r.storybook).length,
  };
});

const verdicts = (arm, id) =>
  runsFor(arm).map((r) => r.spec.items.find((i) => i.id === id)?.verdict ?? 'missed');

const requirements = GROUPS.map(([group, items]) => [
  group,
  items.map(([id, label]) => [label, ...SETUPS.map((s) => verdicts(s.arm, id))]),
]);

// Standards rules where the setups differ, for the standards table.
const standardsIds = [
  ...new Set(runsFor('with-skill').flatMap((r) => (r.standards?.items ?? []).map((i) => i.id))),
];
const unscored = runsFor('with-skill')[0].standards?.unscored ?? [];
const standardsRows = standardsIds
  .filter((id) => !unscored.includes(id))
  .map((id) => [
    id,
    ...SETUPS.map((s) => runsFor(s.arm).map((r) => r.standards?.items.find((i) => i.id === id)?.verdict ?? 'missed')),
  ])
  .filter((row) => new Set(row.slice(1).map((v) => JSON.stringify(v))).size > 1);

writeFileSync(
  'data.js',
  `// Generated by build-data.mjs from ${prefix} eval results. Do not edit by hand.\n` +
    `var SETUPS = ${JSON.stringify(setups, null, 2)};\n` +
    `var REQUIREMENTS = ${JSON.stringify(requirements, null, 2)};\n` +
    `var STANDARDS_ROWS = ${JSON.stringify(standardsRows, null, 2)};\n`,
);
console.log('Wrote data.js');
