import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { generatePayload, getUri } from './utils';
import * as yaml from 'js-yaml';
import { generateMask } from './processor';

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let currentFilePath: string | undefined = undefined; // Keep track of the file path

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "data-model-masking-extension" is now active!');

  context.subscriptions.push(
    vscode.commands.registerCommand('data-model-masking.openSchemaFile', (uri: vscode.Uri) => {
      if (uri) {
        createOrShow(context.extensionUri, uri.fsPath);
      } else {
        if (vscode.window.activeTextEditor) {
          createOrShow(context.extensionUri, vscode.window.activeTextEditor.document.uri.fsPath);
        }
      }
    })
  );

  // to detect changes in schema and push the new content webview
  // vscode.workspace.onDidSaveTextDocument(async (e: vscode.TextDocument) => {
  //   console.log('Document changed.');
  //   console.log(e.getText());
  //   console.log('Document changed Parsed schema');

  //   const theme = await getCurrentTheme();

  //   const parsedSchema = await parseSchemaFile(e.uri.fsPath);
  //   console.log(parsedSchema);

  //   if (currentPanel) {
  //     currentPanel?.webview.postMessage({ type: 'fileContent', data: JSON.stringify(parsedSchema), theme: theme });
  //   }
  // });

  // to manage the change in theme and update the custom preview's theme dynamically
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(colorTheme => {
      console.log(`Theme changed: ${JSON.stringify(colorTheme)}`);
      let theme = 'light';
      if ([2, 3].includes(colorTheme.kind)) {
        theme = 'dark';
      }
      if (currentPanel) {
        currentPanel?.webview.postMessage({ type: 'theme', data: theme });
      }
    })
  );
}

async function createOrShow(extensionUri: vscode.Uri, filePath: string) {
  console.log(`createOrShow() called with filePath: ${filePath} and extensionUri: ${extensionUri}`);
  console.log(`current color theme: ${vscode.workspace.getConfiguration().get("workbench.colorTheme")}`);

  const column = vscode.window.activeTextEditor
    ? vscode.window.activeTextEditor.viewColumn
    : undefined;

  if (currentPanel) {
    console.log(`currentPanel present: ${currentPanel}`);
    currentPanel.title = path.basename(filePath);
    //currentPanel.reveal(column);
  } else {
    console.log(`Creating new currentPanel`);
    currentPanel = vscode.window.createWebviewPanel(
      'json-schema-viewer',
      path.basename(filePath),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      }
    );

    currentPanel.onDidDispose(
      () => {
        currentPanel = undefined;
      },
      null,
      []
    );
  }
  console.log(`Setting html for webview. extensionUri: ${extensionUri}`);
  const theme = await getCurrentTheme();
  currentPanel.webview.html = getHtmlForWebview(currentPanel.webview, extensionUri, filePath, theme);
  //console.log(`Response from getHtmlForWebview() method: ${currentPanel.webview.html}`);

  //Don't need the below message as WebView cannot access file with the filePath. Have to send the complete content
  //currentPanel.webview.postMessage({ type: 'openFile', data: filePath });

  currentPanel.webview.onDidReceiveMessage(async (data) => {
    console.log(`Recieved message in extension host: ${JSON.stringify(data)}`);
    switch (data.type) {
      case 'ready': {
        console.log(`Webview is ready! : currentPanel : ${JSON.stringify(currentPanel)}`);
        try {
          //parse the content to dereference
          const dataModelPayload = await generatePayload(filePath);
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: dataModelPayload, theme: theme });
        } catch (error) {
          console.error('Error parsing dataModelPayload:', error);
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: null });
        }
        break;
      }
      case 'create-mask': {
        console.log(`Create Mask Message Recieved: ${JSON.stringify(data)}`);
        try {
          //parse the content to dereference
          const workspaceBasePath = vscode.workspace.rootPath || "";
          console.log(`workspaceBasePath: ${workspaceBasePath}`);
          await generateMask(workspaceBasePath, data?.content);
        } catch (error) {
          console.error('Error creating masks', error);
        }
        break;
      }
      default:
        console.log(`Recieved message in extension host: ${JSON.stringify(data)}`);
        break;
    }
  });
}

/**
 * 
 * Fetch current theme of VS code
 * @returns 
 * 
 */
async function getCurrentTheme(): Promise<string> {
  return new Promise((resolve, reject) => {
    let theme = 'light';
    if ((vscode.workspace.getConfiguration().get("workbench.colorTheme") as string)?.toLowerCase().includes('dark')) {
      theme = 'dark';
    }
    resolve(theme);
  });
}

/**
 * 
 * @param webview 
 * @param extensionUri 
 * @param filePath 
 * @param theme 
 * @returns 
 */
function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri, filePath: string, theme: string) {
  console.log(`getHtmlForWebview() method`);
  const { scriptUri, styleUri } = getDistFileUris(webview, extensionUri, theme);
  console.log(`scriptUri: ${scriptUri}`);
  console.log(`styleUri: ${styleUri}`);
  //console.log(`styleThemeUri: ${styleThemeUri}`);
  const nonce = getNonce();

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>JSON Schema Viewer</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" type="text/javascript" src="${scriptUri}"></script>
      </body>
    </html>
  `;
}

function getDistFileUris(webview: vscode.Webview, extensionUri: vscode.Uri, theme: string = 'light') {
  const scriptDistPath = path.join(extensionUri.fsPath, 'webview-ui', 'build', 'static', 'js');
  const scriptFiles = fs.readdirSync(scriptDistPath);
  const styleDistPath = path.join(extensionUri.fsPath, 'webview-ui', 'build', 'static', 'css');
  const styleFiles = fs.readdirSync(styleDistPath);

  const scriptFile = scriptFiles.find(file => file.startsWith('main') && file.endsWith('.js'));
  const styleFile = styleFiles.find(file => file.startsWith('main') && file.endsWith('.css'));

  if (!scriptFile || !styleFile) {
    console.log(`Could not find built webview files.`);
    throw new Error('Could not find built webview files.');
  }

  const scriptUri = getUri(webview, extensionUri, ['webview-ui', 'build', 'static', 'js', scriptFile]);
  // Direct access to styling from the src folder has to be removed. Currently used as a work around till webpack is fixed 
  // to properly bundle css files into dist output
  const styleUri = getUri(webview, extensionUri, ['webview-ui', 'build', 'static', 'css', styleFile]);
  //let styleThemeUri = getUri(webview, extensionUri, ['webview-ui', 'src', 'light.css']);

  //Theme selection should happen at webview reactjs app level. Currently below code is a work around
  // if (theme.toLowerCase().includes('dark')) {
  //   styleThemeUri = getUri(webview, extensionUri, ['webview-ui', 'src', 'dark.css']);
  // }

  return { scriptUri, styleUri };
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
