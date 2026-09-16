import { cindyParser } from './cindy.js';
const parser = cindyParser({ id: 'cindy-global', label: 'Cindy（海外版）', name: 'CindyGlobal', env: 'MACLAWD_CINDY_GLOBAL_DIR' });
export const { id, label, readMode, dataDirs, discover, createFileParser } = parser;
