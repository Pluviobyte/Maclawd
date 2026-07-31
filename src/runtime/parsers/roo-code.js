import { createTaskIndexParser } from './vscode-forks.js';

/**
 * Roo Code：`<宿主>/User/globalStorage/rooveterinaryinc.roo-cline/tasks/`
 * 既有总索引 `_index.json`，也有每个任务自己的 `history_item.json`。
 * 两者都收，靠任务 id 去重（同一任务出现两次会折叠成一条）。
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
