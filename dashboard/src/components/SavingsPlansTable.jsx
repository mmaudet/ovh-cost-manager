// Savings plans of a project, read from the bills: there is no savings plan
// route under /cloud/project in the v6 API.
const SavingsPlansTable = ({ plans, language, fmt }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b bg-gray-50">
        <th className="p-2 text-left font-medium">{language === 'en' ? 'Plan' : 'Plan'}</th>
        <th className="p-2 text-left font-medium">Flavor</th>
        <th className="p-2 text-right font-medium">{language === 'en' ? 'Covered' : 'Couvert'}</th>
        <th className="p-2 text-left font-medium">{language === 'en' ? 'Last billed' : 'Dernière facture'}</th>
        <th className="p-2 text-right font-medium">{language === 'en' ? 'Cost' : 'Coût'}</th>
      </tr>
    </thead>
    <tbody>
      {plans.map((plan, i) => {
        // Coverage is per flavor: all the plans of that flavor, summed
        const over = plan.inventory !== null && plan.flavorCovered > plan.inventory;
        return (
          <tr key={plan.id || i} className="border-b hover:bg-gray-50">
            <td className="p-2 font-medium text-xs truncate max-w-[220px]" title={plan.id}>{plan.id}</td>
            <td className="p-2 text-xs">{plan.flavor}</td>
            <td className="p-2 text-right text-xs">
              <span
                className={`px-1.5 py-0.5 rounded ${over ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}
                title={over
                  ? (language === 'en'
                    ? 'The plans of this flavor pay for more instances than the project runs'
                    : 'Les plans de ce flavor paient plus d\'instances que le projet n\'en fait tourner')
                  : (language === 'en'
                    ? 'Instances paid by all the plans of this flavor / instances of that flavor in the inventory'
                    : 'Instances payées par tous les plans de ce flavor / instances de ce flavor dans l\'inventaire')}
              >
                {plan.inventory !== null ? `${plan.flavorCovered} / ${plan.inventory}` : plan.covered}
              </span>
            </td>
            <td className="p-2 text-xs text-gray-500">{plan.lastDate || '-'}</td>
            <td className="p-2 text-right font-medium text-xs">{fmt(plan.total)}€</td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

const savingsPlanCsvColumns = (language) => [
  { key: 'id', label: 'Plan' },
  { key: 'flavor', label: 'Flavor' },
  { key: 'covered', label: language === 'en' ? 'Instances covered' : 'Instances couvertes' },
  { key: 'flavorCovered', label: language === 'en' ? 'Instances covered (flavor total)' : 'Instances couvertes (total du flavor)' },
  { key: 'inventory', label: language === 'en' ? 'Instances in inventory' : 'Instances en inventaire' },
  { key: 'duration', label: language === 'en' ? 'Duration' : 'Durée' },
  { key: 'months', label: language === 'en' ? 'Billed months' : 'Mois facturés' },
  { key: 'firstDate', label: language === 'en' ? 'First billed' : 'Première facture' },
  { key: 'lastDate', label: language === 'en' ? 'Last billed' : 'Dernière facture' },
  { key: 'total', label: language === 'en' ? 'Cost (EUR)' : 'Coût (EUR)' }
];

export { SavingsPlansTable, savingsPlanCsvColumns };
