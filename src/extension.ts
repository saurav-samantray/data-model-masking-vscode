import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { generatePayload, getThemeName, getUri } from './utils';
import * as yaml from 'js-yaml';
import { generateMask } from './processor';

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let currentFilePath: string | undefined = undefined; // Keep track of the file path

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "data-model-masking-extension" is now active!');

  context.subscriptions.push(
    vscode.commands.registerCommand('data-model-masking.openSchemaFile', (uri: vscode.Uri) => {
      if (uri) {
        createOrShow(context, uri.fsPath);
      } else {
        if (vscode.window.activeTextEditor) {
          createOrShow(context, vscode.window.activeTextEditor.document.uri.fsPath);
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
  // Listen for theme changes and inform the webview
  context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(e => {
    if (currentPanel) {
      const newTheme = getThemeName(e.kind);
      console.log(`Theme changed, sending new theme to webview: ${newTheme}`);
      currentPanel.webview.postMessage({ type: 'setTheme', theme: newTheme });
    }
  }));
}

function createOrShow(context: vscode.ExtensionContext, filePath: string) {
  const extensionUri = context.extensionUri; // Get extensionUri from context
  const column = vscode.window.activeTextEditor
    ? vscode.window.activeTextEditor.viewColumn
    : undefined;


  // If we already have a panel, show it.
  if (currentPanel) {
    // If the file path is different, update the content
    if (currentFilePath !== filePath) {
      currentFilePath = filePath;
      // Post a message to the webview to clear existing state before loading new data
      currentPanel.webview.postMessage({ type: 'clearState' });
      // Send new payload (handle potential errors)
      generatePayload(filePath)
        .then(dataModelPayload => {
          const currentTheme = getThemeName(vscode.window.activeColorTheme.kind); // Get theme again
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: dataModelPayload, theme: currentTheme }); // Send theme with payload
        })
        .catch(error => {
          console.error('Error generating dataModelPayload for existing panel:', error);
          vscode.window.showErrorMessage(`Error loading schema: ${error.message}`);
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: null }); // Send null on error
        });
    }
    currentPanel.reveal(column);
    return;
  }

  // Otherwise, create a new panel.
  currentFilePath = filePath; // Store the path for the new panel
  const panel = vscode.window.createWebviewPanel(
    'dataModelMasking', // Identifies the type of the webview. Used internally
    `Mask Editor: ${path.basename(filePath)}`, // Title of the panel displayed to the user
    column || vscode.ViewColumn.One, // Editor column to show the new webview panel in.
    {
      enableScripts: true, // Enable javascript in the webview
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview-ui', 'build')] // Restrict the webview to only loading content from our extension's `dist` directory.
    }
  );
  currentPanel = panel; // Store reference

  panel.webview.html = getHtmlForWebview(panel.webview, extensionUri);


  console.log(`Setting html for webview. extensionUri: ${extensionUri}`);
  //currentPanel.webview.html = getHtmlForWebview(currentPanel.webview, extensionUri);
  //console.log(`Response from getHtmlForWebview() method: ${currentPanel.webview.html}`);

  //Don't need the below message as WebView cannot access file with the filePath. Have to send the complete content
  //currentPanel.webview.postMessage({ type: 'openFile', data: filePath });

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage(async (data) => {
    console.log(`Recieved message in extension host: ${JSON.stringify(data)}`);
    switch (data.type) {
      case 'ready': {
        console.log(`Webview is ready! Sending initial payload for: ${currentFilePath}`);
        if (!currentFilePath) {
          console.error("Cannot send dataModelPayload: currentFilePath is missing.");
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: null });
          return;
        }
        try {
          const dataModelPayload = await generatePayload(currentFilePath);
          const currentTheme = getThemeName(vscode.window.activeColorTheme.kind); // Get current theme
          console.log(`Sending initial theme: ${currentTheme}`);
          // Send theme *first*, then payload
          currentPanel?.webview.postMessage({ type: 'setTheme', theme: currentTheme });
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: dataModelPayload });
        } catch (error: any) {
          console.error('Error generating dataModelPayload:', error);
          vscode.window.showErrorMessage(`Error loading schema: ${error.message}`);
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: null });
        }
        break;
      }
      case 'create-mask': {
        console.log(`Create Mask Message Recieved: ${JSON.stringify(data)}`);
        if (!currentFilePath) { // Ensure we still have the context file path
          console.error("Cannot create mask: Original file path context is missing.");
          vscode.window.showErrorMessage("Cannot create mask: Original file path context is missing.");
          return;
        }
        if (!data || typeof data.content !== 'string') {
          console.error("Cannot create mask: Invalid or missing selection content received.");
          vscode.window.showErrorMessage("Cannot create mask: Invalid or missing selection content received.");
          return;
        }
        try {
          //parse the content to dereference
          const workspaceBasePath = vscode.workspace.rootPath || "";
          console.log(`workspaceBasePath: ${workspaceBasePath}`);
          await generateMask(data.content, currentFilePath);
        } catch (error) {
          console.error('Error creating masks', error);
        }
        break;
      }
      // --- THIS CASE SHOULD HANDLE THE MESSAGE ---
      case 'selectOutputDirectory': {
        console.log("Received request to select output directory.");
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectMany: false,
                canSelectFiles: false,
                canSelectFolders: true,
                openLabel: 'Select Output Folder',
                // Optionally set a default URI based on workspace or current file
                // defaultUri: vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : undefined
            };

            const result = await vscode.window.showOpenDialog(options);

            if (result && result.length > 0) {
                const selectedFolderPath = result[0].fsPath;
                console.log(`Folder selected: ${selectedFolderPath}`);
                // Send the selected path back to the webview
                panel?.webview.postMessage({ type: 'setOutputDirectory', path: selectedFolderPath });
            } else {
                console.log("Folder selection cancelled by user.");
            }
        } catch (error: any) {
            console.error('Error showing open dialog:', error);
            vscode.window.showErrorMessage(`Error selecting folder: ${error.message}`);
        }
        break; // Make sure break is here
    }
    // --- END OF HANDLER ---
      default:
        console.log(`Received unhandled message type: ${data.type}`);
        break;
    }
  });
  // Handle panel disposal
  panel.onDidDispose(() => {
    currentPanel = undefined;
    currentFilePath = undefined; // Clear path on dispose
  }, null, context.subscriptions); // Use context.subscriptions for disposal management
}

/**
 * 
 * Fetch current theme of VS code
 * @returns 
 * 
 */
// async function getCurrentTheme(): Promise<string> {
//   return new Promise((resolve, reject) => {
//     let theme = 'light';
//     if ((vscode.workspace.getConfiguration().get("workbench.colorTheme") as string)?.toLowerCase().includes('dark')) {
//       theme = 'dark';
//     }
//     resolve(theme);
//   });
// }

/**
 * 
 * @param webview 
 * @param extensionUri 
 * @param filePath 
 * @param theme 
 * @returns 
 */
function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri) {
  console.log(`getHtmlForWebview() method`);
  const { scriptUri, styleUri } = getDistFileUris(webview, extensionUri);
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

function getDistFileUris(webview: vscode.Webview, extensionUri: vscode.Uri) {
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
