import { invoke } from '@tauri-apps/api/core'

export const tauriBridge = {
  readFile: (path: string) => invoke<string>('read_file', { path }),
  writeFile: (path: string, contents: string) => invoke<void>('write_file', { path, contents }),
  listDir: (path: string) => invoke<string[]>('list_dir', { path }),
  runShell: (command: string, args: string[]) => invoke<string>('run_shell', { command, args }),
  showNotification: (title: string, body: string) => invoke<void>('show_notification', { title, body }),
  getVersion: () => invoke<string>('get_version'),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
}