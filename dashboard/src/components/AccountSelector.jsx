import { accountLabel, offersAccounts } from '../utils/accounts.js';
import { HeaderSelect } from './HeaderSelect.jsx';

// The account selector of the header (#115): all accounts, then each account of the
// instance, in the order of the accounts route. Nothing while their list loads, nor when the
// instance knows a single account.
export function AccountSelector({ accounts, selectedAccount, onSelect, t }) {
  if (!accounts || !offersAccounts(accounts)) return null;
  return (
    <HeaderSelect
      aria-label={t('account')}
      value={selectedAccount ?? ''}
      onChange={(e) => onSelect(e.target.value || null)}
    >
      <option value="">{t('allAccounts')}</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>{accountLabel(account, t)}</option>
      ))}
    </HeaderSelect>
  );
}
