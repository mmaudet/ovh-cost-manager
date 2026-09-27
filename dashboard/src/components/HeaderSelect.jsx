// The look of the selectors of the header, the account's and the month's (#115)
const HEADER_SELECT_CLASSES = 'px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm'
  + ' shadow-sm cursor-pointer';

// A selector of the header: a dropdown with their look, and the props of a select
export function HeaderSelect(props) {
  return <select {...props} className={HEADER_SELECT_CLASSES} />;
}
