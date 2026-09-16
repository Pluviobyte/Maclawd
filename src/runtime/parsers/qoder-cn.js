import { qoderParser } from './qoder.js';
const parser = qoderParser({ id: 'qoder-cn', label: 'Qoder（国内版）', name: 'QoderCN', env: 'QODERCN', cli: '.qoder-cn' });
export const { id, label, lineFilter, dataDirs, discover, createFileParser } = parser;
