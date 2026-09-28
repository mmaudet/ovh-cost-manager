/**
 * The class of an object storage bucket as OCM names it, from the storage class that OVH gives
 * each of its objects (cloud.storage.StorageClassEnum), in the words of OVHcloud's guides:
 * GLACIER_IR is Active Archive, and DEEP_ARCHIVE Cold Archive (#145). A class that OCM names
 * already, as the import stored it, or that it does not know, reads as it is. Without side
 * effects.
 */

const LABELS = {
  STANDARD: 'Standard',
  STANDARD_IA: 'Standard IA',
  HIGH_PERFORMANCE: 'High Performance',
  HIGH_PERF: 'High Performance',
  GLACIER_IR: 'Active Archive',
  DEEP_ARCHIVE: 'Cold Archive',
};

/**
 * @param {?string} storageClass - As OVH gives it, or as OCM stored it
 * @returns {?string} Its name, null for none
 */
const storageClassLabel = (storageClass) => (
  storageClass == null ? null : LABELS[storageClass] || storageClass
);

module.exports = { storageClassLabel };
