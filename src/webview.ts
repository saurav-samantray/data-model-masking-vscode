// import * as vscode from 'vscode';
// import * as fs from 'fs';
// import * as path from 'path';
// import { getUri } from './utils';

// export class SchemaViewProvider implements vscode.WebviewViewProvider {
//   public static readonly viewType = 'json-schema-viewer-view';

//   private _view?: vscode.WebviewView;
//   private _filePath?: string;

//   constructor(private readonly _extensionUri: vscode.Uri) { }

//   public resolveWebviewView(
//     webviewView: vscode.WebviewView,
//     context: vscode.WebviewViewResolveContext,
//     _token: vscode.CancellationToken,
//   ) {
//     this._view = webviewView;

//     webviewView.webview.options = {
//       enableScripts: true,
//       localResourceRoots: [this._extensionUri],
//     };

//     webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

//     webviewView.webview.onDidReceiveMessage(async (data) => {
//       switch (data.type) {
//         case 'ready': {
//           console.log('Webview is ready!');
//           if (this._filePath) {
//             webviewView.webview.postMessage({ type: 'openFile', data: this._filePath });
//           }
//           break;
//         }
//         default:
//           console.log(`Recieved Message: ${data}`);
//           break;
//       }
//     });
//   }

//   public show(filePath?: string) {
//     if (filePath) {
//       this._filePath = filePath;
//     }
//     if (this._view) {
//       this._view.show(true);
//     }
//   }

//   private _getHtmlForWebview(webview: vscode.Webview) {
//     const { scriptUri, styleUri } = this.getDistFileUris(webview);
//     const toolkitUri = getUri(webview, this._extensionUri, [
//       'node_modules',
//       'vscode-webview-ui-toolkit',
//       'dist',
//       'toolkit.js',
//     ]);

//     return `
//       <!DOCTYPE html>
//       <html lang="en">
//         <head>
//           <meta charset="UTF-8">
//           <meta name="viewport" content="width=device-width, initial-scale=1.0">
//           <script type="module" src="${toolkitUri}"></script>
//           <link rel="stylesheet" href="${styleUri}">
//           <title>JSON Schema Viewer</title>
//         </head>
//         <body>
//           <div id="root"></div>
//           <script type="module" src="${scriptUri}"></script>
//         </body>
//       </html>
//     `;
//   }

//   private getDistFileUris(webview: vscode.Webview) {
//     const distPath = path.join(this._extensionUri.fsPath, 'webview-ui', 'dist', 'assets');
//     const files = fs.readdirSync(distPath);

//     const scriptFile = files.find(file => file.startsWith('main') && file.endsWith('.js'));
//     const styleFile = files.find(file => file.startsWith('main') && file.endsWith('.css'));

//     if (!scriptFile || !styleFile) {
//       throw new Error('Could not find built webview files.');
//     }

//     const scriptUri = getUri(webview, this._extensionUri, ['webview-ui', 'dist', 'assets', scriptFile]);
//     const styleUri = getUri(webview, this._extensionUri, ['webview-ui', 'dist', 'assets', styleFile]);

//     return { scriptUri, styleUri };
//   }
// }
