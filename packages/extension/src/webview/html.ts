import { randomBytes } from 'node:crypto'

import * as vscode from 'vscode'

/** Which React app the shared webview bundle renders. */
export type WebviewApp = 'results' | 'connection-form'

export function webviewRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
}

/** Page for the webview bundle in dist/webview, with a nonce-based CSP. */
export function webviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  app: WebviewApp,
  title: string,
): string {
  const root = webviewRoot(extensionUri)
  const nonce = randomBytes(16).toString('base64')
  const script = webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.js'))
  const style = webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.css'))
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${style.toString()}" />
    <title>${title}</title>
  </head>
  <body data-app="${app}">
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${script.toString()}"></script>
  </body>
</html>`
}
