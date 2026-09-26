import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { triggerImport } from '../services/api.js';

// The translation key of what the server answered a resync it refused
const refusalKey = (err) => {
  const status = err?.response?.status;
  if (status === 429) return 'syncRateLimited';
  if (err?.response?.data?.error === 'syncDisabled') return 'syncDisabled';
  if (status === 409) return 'syncRunning';
  return 'syncError';
};

// The resync: a button that asks the server for a differential import, and under it what
// the server answered. The header renders it, and so does the page shown when no month is
// billed (#51). The import status refreshes 8 s after the import starts; the shell then
// refreshes the imported data once the import is over.
const ResyncButton = ({ t }) => {
  const queryClient = useQueryClient();
  // What the server answered, as a translation key, and whether the import started
  const [feedback, setFeedback] = useState(null);
  const resync = useMutation({
    mutationFn: triggerImport,
    onSuccess: () => {
      setFeedback({ started: true, key: 'syncStarted' });
      // The import runs in the background; refresh status a bit later.
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['importStatus'] }), 8000);
    },
    onError: (err) => setFeedback({ started: false, key: refusalKey(err) }),
  });

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={() => { setFeedback(null); resync.mutate(); }}
        disabled={resync.isPending}
        title={t('resync')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border ${
          resync.isPending
            ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 cursor-pointer'
        } transition-colors`}
      >
        <span className={resync.isPending ? 'animate-spin' : ''}>⟳</span>
        <span>{resync.isPending ? t('syncing') : t('resync')}</span>
      </button>
      {feedback && (
        <p className={`max-w-xs text-center text-sm font-medium ${
          feedback.started ? 'text-green-600' : 'text-red-600'
        }`}>
          {t(feedback.key)}
        </p>
      )}
    </div>
  );
};

export { ResyncButton };
