import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BucketsTable } from '../../src/components/BucketsTable.jsx';
import { translations } from '../../src/i18n/translations.js';

// The page's translations in French, as useLanguage() gives them
const t = (key) => translations.fr[key] || key;
// The table's sort as its tab gives it until the user sorts it: none (#146)
const unsorted = { sort: null, onSort: () => {} };

// OVHcloud gives a class to each object, never to a bucket (#145)
describe('BucketsTable', () => {
  it('says why a bucket has no class', () => {
    render(
      <BucketsTable
        language="fr" t={t} fmt={(amount) => String(amount)} sorting={unsorted}
        buckets={[
          { name: 'empty', type: null, objectsCount: 0, inInventory: true, total: 0 },
          { name: 'unread', type: null, objectsCount: 4, inInventory: true, total: 1 },
          // Its name's mark says it is gone from the inventory
          { name: 'gone', type: null, objectsCount: null, inInventory: false, total: 2 },
        ]}
      />,
    );

    expect(screen.getByText('Vide')).toHaveAttribute(
      'title', "Un bucket vide n'a pas de classe : OVHcloud en donne une à chaque objet",
    );
    // By name, as the table sorts them: gone, then unread
    expect(screen.getAllByText('Inconnu').map((type) => type.getAttribute('title')))
      .toEqual([null, "OVHcloud n'a pas donné la classe de ses objets"]);
  });
});
