// Policy changes retire only these system reasons; personal choices and other
// editorial decisions retain their existing scope and lifetime.
export const FILTER_POLICY_REVISION = 'allowed-products-opinions-sports-v2';
const retired = new Set([
  'TECH_VN_ORDINARY_PRODUCT_OR_FEATURE',
  'TECH_VN_OPINION_OR_POTENTIAL',
  'VN_ROUTINE_SPORTS',
  'VN_NEWS_ROUTINE_SPORTS',
]);

export const retiredReason = code => retired.has(code);

export function retireSavedReasons(record) {
  let changed = false;
  for (const [section, decision] of Object.entries(record.decisions || {})) {
    if (!retiredReason(decision?.reasonCode)) continue;
    delete record.decisions[section];
    changed = true;
  }
  return changed;
}
