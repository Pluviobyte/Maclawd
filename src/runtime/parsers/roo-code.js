import { createTaskIndexParser } from './vscode-forks.js';

/**
 * Roo Code：`<宿主>/User/globalStorage/rooveterinaryinc.roo-cline/tasks/`
 * 既有总索引 `_index.json`，也有每个任务自己的 `history_item.json`。
 * 优先逐任务的 ui_messages.json，每次调用独立归日/模型。
 * 只有明细缺失时才保留摘要，不把摘要与明细相加。
 */
const parser = createTaskIndexParser({
  id: 'roo-code',
  label: 'Roo Code',
  extensionId: 'rooveterinaryinc.roo-cline',
  indexFiles: ['_index.json', 'history_item.json', 'taskHistory.json'],
});

export const {
  id, label, readMode, lineFilter, dataDirs, discover, createFileParser,
} = parser;
