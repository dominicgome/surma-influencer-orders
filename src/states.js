'use strict';
// Indian states / UTs -> Shopify province codes
const STATES = {
  'Andaman and Nicobar Islands': 'AN', 'Andhra Pradesh': 'AP', 'Arunachal Pradesh': 'AR', 'Assam': 'AS',
  'Bihar': 'BR', 'Chandigarh': 'CH', 'Chhattisgarh': 'CG', 'Dadra and Nagar Haveli': 'DN', 'Daman and Diu': 'DD',
  'Delhi': 'DL', 'Goa': 'GA', 'Gujarat': 'GJ', 'Haryana': 'HR', 'Himachal Pradesh': 'HP',
  'Jammu and Kashmir': 'JK', 'Jharkhand': 'JH', 'Karnataka': 'KA', 'Kerala': 'KL', 'Ladakh': 'LA',
  'Lakshadweep': 'LD', 'Madhya Pradesh': 'MP', 'Maharashtra': 'MH', 'Manipur': 'MN', 'Meghalaya': 'ML',
  'Mizoram': 'MZ', 'Nagaland': 'NL', 'Odisha': 'OD', 'Puducherry': 'PY', 'Punjab': 'PB', 'Rajasthan': 'RJ',
  'Sikkim': 'SK', 'Tamil Nadu': 'TN', 'Telangana': 'TS', 'Tripura': 'TR', 'Uttar Pradesh': 'UP',
  'Uttarakhand': 'UT', 'West Bengal': 'WB',
};
const ALIASES = { 'new delhi': 'Delhi', 'nct of delhi': 'Delhi', 'orissa': 'Odisha', 'uttaranchal': 'Uttarakhand', 'pondicherry': 'Puducherry' };

function resolveState(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (ALIASES[s]) return { name: ALIASES[s], code: STATES[ALIASES[s]] };
  for (const [name, code] of Object.entries(STATES)) {
    if (name.toLowerCase() === s || code.toLowerCase() === s) return { name, code };
  }
  return null;
}

module.exports = { STATES, resolveState };
