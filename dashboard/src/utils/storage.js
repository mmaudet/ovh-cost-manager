// What the browser keeps of the page from one visit to the next: the language and the account
// selected. A browser can refuse it, as some private windows do, or one that blocks the data
// of sites: the page then keeps nothing, and opens on its defaults.

// The value kept under a key: null when there is none, or when the browser refuses storage
export function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Keeps a value under a key, or forgets the key for null. When the browser refuses storage,
// nothing is kept: the value lasts until the page closes.
export function store(key, value) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Not kept
  }
}
