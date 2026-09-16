export function normalizeServiceTier(value) {
  const tier=typeof value==='string'?value.trim().toLowerCase():'';
  if(['','default','standard','auto'].includes(tier))return 'standard';
  return tier==='priority'?'fast':tier;
}
