import { createTaskIndexParser } from './vscode-forks.js';

/**
 * Cline：`<宿主>/User/globalStorage/saoudrizwan.claude-dev/state/taskHistory.json`
 * 老版本把任务历史直接放在扩展目录根下，两种都收。
 */
const parser = createTaskIndexParser({
  id: 'cline',
  label: 'Cline',
  extensionId: 'saoudrizwan.claude-dev',
  indexFiles: ['taskHistory.json', 'history_item.json'],
});

export const {
  id, label, readMode, lineFilter, dataDirs, discover, createFileParser,
} = parser;
