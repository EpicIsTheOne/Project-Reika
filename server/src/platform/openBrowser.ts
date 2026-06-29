import { execFile } from 'node:child_process';

export function openLocalUrl(url: string) {
  if (process.env.REIKA_PAIRING_UI_OPEN === '0' || process.env.REIKA_PAIRING_UI_OPEN === 'false') return;

  const command = process.platform === 'win32'
    ? { file: 'cmd', args: ['/c', 'start', '', url] }
    : process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : { file: 'xdg-open', args: [url] };

  const child = execFile(command.file, command.args, { windowsHide: true }, () => {});
  child.unref();
}
