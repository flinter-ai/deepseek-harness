/** Source-editor namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'sourceEditor'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'open': '打开源码编辑器',
  'title': '源码草稿',
  'loading': '正在打开项目…',
  'empty': '新建 Sandpack 草稿',
  'base': '基线',
  'files': '{count} 个文件',
  'save': '保存草稿',
  'saving': '保存中…',
  'publish': '创建 PR',
  'publishing': '发布中…',
  'delete': '删除草稿',
  'close': '关闭',
  'saved': '已保存',
  'dirty': '未保存',
  'conflict': '发生冲突',
  'published': '已创建 PR',
  'idle': '未保存',
  'error': '错误',
  'publisherUnavailable': 'Host 尚未配置 Git/PR publisher',
  'publishLink': '打开 Pull Request',
  'deleteConfirm': '删除远端草稿？当前本地编辑内容会保留为未保存状态。',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<SourceEditorKey, string> = {
  'open': 'Open source editor',
  'title': 'Source draft',
  'loading': 'Opening project…',
  'empty': 'New Sandpack draft',
  'base': 'Base',
  'files': '{count} files',
  'save': 'Save draft',
  'saving': 'Saving…',
  'publish': 'Create PR',
  'publishing': 'Publishing…',
  'delete': 'Delete draft',
  'close': 'Close',
  'saved': 'Saved',
  'dirty': 'Unsaved',
  'conflict': 'Conflict',
  'published': 'PR created',
  'idle': 'Not saved',
  'error': 'Error',
  'publisherUnavailable': 'Host Git/PR publisher is not configured',
  'publishLink': 'Open Pull Request',
  'deleteConfirm': 'Delete the remote draft? Local editor content remains unsaved.',
}

/** Key domain of the `sourceEditor` namespace. */
export type SourceEditorKey = keyof typeof zh
