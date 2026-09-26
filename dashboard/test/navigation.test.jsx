import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import {
  cloudProjectRow,
  costsByResourceType,
  openProject,
  openTab,
  projectBreakdown,
  projectDetailHeadings,
  renderDashboard,
  resourceType,
  resourceTypeBreakdown,
  settle,
  texts,
} from './support/render.jsx';

// What each way of moving around the page keeps open, as decided in #56: the tab bar keeps
// everything, the logo goes back to a clean Overview, and each link of the Overview opens
// exactly its target. Two things can stay open: a Public Cloud project, its detail under
// it, and a resource type of the Infrastructure tab, its bill lines under it.

// A link of the Overview's breakdown by resource type, to the Infrastructure or Web Cloud tab
const breakdownLink = (name) => within(resourceTypeBreakdown()).getByRole('button', { name });

// The costs by resource type of September, with the bill lines of the dedicated servers
// open under them, then with none open
const withServerBillLines = [
  'Coûts par type de ressource', '(Septembre 2026)',
  'Dedicated Servers', '270,00€', '▲',
  'Service', 'Description', 'Montant',
  'ns3000001.ip-203-0-113.eu',
  'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois', '270,00€',
  'Backup', '90,00€', '▼',
  'Licenses', '25,00€', '▼',
];
const withNoBillLines = [
  'Coûts par type de ressource', '(Septembre 2026)',
  'Dedicated Servers', '270,00€', '▼',
  'Backup', '90,00€', '▼',
  'Licenses', '25,00€', '▼',
];
// The first headings of the detail of the Production project
const productionDetail = [
  ['Consommation par ressource'],
  ['Instances (5)', '538,90€', 'Tout afficher', 'CSV'],
];

// Opens the Production project on the Public Cloud tab, then the bill lines of the
// dedicated servers on the Infrastructure tab, where the user stays. Every test starts
// there, so the helper checks that both opened.
const openProjectAndResourceType = async () => {
  const { user } = await renderDashboard();
  await openTab(user, 'Public Cloud');
  await openProject(user, 'Production');
  expect(texts(cloudProjectRow('Production'))).toContain('▲');
  await openTab(user, 'Infrastructure');
  await user.click(resourceType('Dedicated Servers'));
  await settle();
  expect(texts(costsByResourceType())).toEqual(withServerBillLines);
  return { user };
};

describe('navigation', () => {
  it('through the tab bar keeps the open project and resource type', async () => {
    const { user } = await openProjectAndResourceType();

    await openTab(user, "Vue d'ensemble");
    await openTab(user, 'Infrastructure');

    expect(texts(costsByResourceType())).toEqual(withServerBillLines);

    await openTab(user, 'Public Cloud');

    expect(texts(cloudProjectRow('Production'))).toContain('▲');
    expect(projectDetailHeadings().slice(0, 2)).toEqual(productionDetail);
  });

  it('through the logo closes the open project and resource type', async () => {
    const { user } = await openProjectAndResourceType();

    await user.click(screen.getByRole('button', { name: 'OVH Cost Manager' }));
    await settle();

    expect(screen.getByText('Répartition par service')).toBeInTheDocument();

    await openTab(user, 'Infrastructure');

    expect(texts(costsByResourceType())).toEqual(withNoBillLines);

    await openTab(user, 'Public Cloud');

    expect(texts(cloudProjectRow('Production'))).toContain('▼');
    expect(projectDetailHeadings()).toEqual([]);
  });

  // The user reaches the Overview through the tab bar, which keeps what is open
  describe("through the Overview's link", () => {
    it('to Infrastructure closes the open resource type, not the project', async () => {
      const { user } = await openProjectAndResourceType();
      await openTab(user, "Vue d'ensemble");

      await user.click(breakdownLink('Voir le détail infrastructure →'));
      await settle();

      expect(texts(costsByResourceType())).toEqual(withNoBillLines);

      await openTab(user, 'Public Cloud');

      expect(texts(cloudProjectRow('Production'))).toContain('▲');
      expect(projectDetailHeadings().slice(0, 2)).toEqual(productionDetail);
    });

    it('to Web Cloud keeps the open project and resource type', async () => {
      const { user } = await openProjectAndResourceType();
      await openTab(user, "Vue d'ensemble");

      await user.click(breakdownLink('Voir le détail Web Cloud (domaines) →'));
      await settle();

      expect(screen.getByText('12 mois glissants')).toBeInTheDocument();

      await openTab(user, 'Infrastructure');

      expect(texts(costsByResourceType())).toEqual(withServerBillLines);

      await openTab(user, 'Public Cloud');

      expect(texts(cloudProjectRow('Production'))).toContain('▲');
      expect(projectDetailHeadings().slice(0, 2)).toEqual(productionDetail);
    });

    it('to a project opens that project, and keeps the open resource type', async () => {
      const { user } = await openProjectAndResourceType();
      await openTab(user, "Vue d'ensemble");

      // Another project than the open one
      await user.click(within(projectBreakdown()).getByRole('button', { name: 'Staging' }));
      await settle();

      expect(texts(cloudProjectRow('Staging'))).toEqual(['Staging', 'ok', '0', '52,35€', '▲']);
      expect(texts(cloudProjectRow('Production'))).toContain('▼');
      expect(projectDetailHeadings()).toEqual([
        ['Consommation par ressource'],
        ['Instances (0)', '180,00€', 'Tout afficher', 'CSV'],
      ]);

      await openTab(user, 'Infrastructure');

      expect(texts(costsByResourceType())).toEqual(withServerBillLines);
    });
  });
});
