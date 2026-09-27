import { accountLabel, offersAccounts } from '../utils/accounts.js';

// The account selector of the header (#115): all accounts, then each account of the
// instance, in the order of the accounts route. Nothing while their list loads, nor when the
// instance knows a single account.
export function AccountSelector({ accounts, selectedAccount, onSelect, t }) {
  if (!accounts || !offersAccounts(accounts)) return null;
  return (
    <select
      aria-label={t('account')}
      value={selectedAccount ?? ''}
      onChange={(e) => onSelect(e.target.value || null)}
      className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm shadow-sm cursor-pointer"
    >
      <option value="">{t('allAccounts')}</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>{accountLabel(account, t)}</option>
      ))}
    </select>
  );
}
