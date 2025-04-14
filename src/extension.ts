// src/extension.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
// Make sure all necessary functions and types are imported
import { generatePayload, loadSchemaFile, parseSchemaString, getThemeName, getUri } from './utils';
import { generateMask } from './processor';
import { RootSelection, Schema } from './types'; // Import RootSelection and Schema

// Constants for suffixes (ensure consistency with processor.ts and utils.ts)
export const MASK_SUFFIX = '.m1'; // Matches writeSchemaFile in utils.ts
const SELECTION_FILE_SUFFIX = '.config.json'; // Matches processor.ts

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let currentFilePath: string | undefined = undefined; // Path of the file currently shown in the editor

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "data-model-masking-extension" is now active!');

  context.subscriptions.push(
    vscode.commands.registerCommand('data-model-masking.openSchemaFile', (uri?: vscode.Uri) => {
      let targetPath: string | undefined;
      if (uri) {
        targetPath = uri.fsPath;
      } else if (vscode.window.activeTextEditor) {
        targetPath = vscode.window.activeTextEditor.document.uri.fsPath;
      } else {
        vscode.window.showErrorMessage("No file specified or active editor found.");
        return;
      }

      if (targetPath) {
        createOrShow(context, targetPath);
      }
    })
  );

  // Theme change listener remains the same
  context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(e => {
    if (currentPanel) {
      const newTheme = getThemeName(e.kind);
      console.log(`Theme changed, sending new theme to webview: ${newTheme}`);
      currentPanel.webview.postMessage({ type: 'setTheme', theme: newTheme });
    }
  }));
}

async function createOrShow(context: vscode.ExtensionContext, filePath: string) {
  const extensionUri = context.extensionUri;
  const column = vscode.window.activeTextEditor
    ? vscode.window.activeTextEditor.viewColumn
    : undefined;

  console.log(`createOrShow called for: ${filePath}`);

  // --- Check if it's an existing mask ---
  let isExistingMask = false;
  let initialSelection: RootSelection['selection'] | undefined = undefined;
  let initialOutputDir: string | undefined = undefined;
  let originalSchemaPathForPayload: string = filePath; // Default to the opened path

  try {
    // Check if the filename has the mask suffix
    const fileExt = path.extname(filePath);
    const fileBaseName = path.basename(filePath, fileExt);

    if (fileBaseName.endsWith(MASK_SUFFIX)) {
      console.log(`File ${filePath} appears to be a masked schema.`);
      const openedSchema = loadSchemaFile(filePath); // Load the masked schema content

      if (openedSchema && typeof openedSchema === 'object' && openedSchema['x-mask-selection']) {
        const selectionFileName = openedSchema['x-mask-selection'];
        const selectionFilePath = path.join(path.dirname(filePath), selectionFileName);
        console.log(`Found x-mask-selection, attempting to load config: ${selectionFilePath}`);

        if (fs.existsSync(selectionFilePath)) {
          const selectionFileContent = fs.readFileSync(selectionFilePath, 'utf-8');
          // The config file *only* contains the 'selection' part in the current implementation
          // Let's assume it might contain the full RootSelection in the future for outputDir
          const parsedConfig = JSON.parse(selectionFileContent);

          // Check if parsedConfig is the selection object directly or the RootSelection object
          if (parsedConfig.mainSchemaId && parsedConfig.selection) { // If it's RootSelection
             initialSelection = parsedConfig.selection;
             initialOutputDir = parsedConfig.outputDir; // Get outputDir if present
             console.log("Loaded selection and outputDir from RootSelection structure in config file.");
          } else if (typeof parsedConfig === 'object' && parsedConfig !== null) { // Assume it's just the selection object
             initialSelection = parsedConfig;
             // Try to get outputDir from the original rootSelection if needed, but it's not stored here currently.
             // We might need to modify generateMask to save the full RootSelection.
             // For now, we'll rely on the default or let the user re-enter/browse.
             console.log("Loaded selection object directly from config file.");
          } else {
             throw new Error("Config file content is not a valid selection object or RootSelection structure.");
          }


          // Infer the original schema path by removing the suffix
          const originalBaseName = fileBaseName.substring(0, fileBaseName.length - MASK_SUFFIX.length);
          const inferredOriginalPath = path.join(path.dirname(filePath), `${originalBaseName}${fileExt}`);

          if (fs.existsSync(inferredOriginalPath)) {
            console.log(`Inferred original schema path: ${inferredOriginalPath}`);
            originalSchemaPathForPayload = inferredOriginalPath; // Use original path for payload generation
            isExistingMask = true;
          } else {
            console.warn(`Could not find inferred original schema at ${inferredOriginalPath}. Proceeding with the masked file for display, but selection might not match structure.`);
            // Keep originalSchemaPathForPayload as filePath - payload will be based on the masked file itself.
            isExistingMask = true; // Still treat as existing mask to load selection, but warn user.
            vscode.window.showWarningMessage(`Opened a masked schema, but couldn't find the inferred original schema (${path.basename(inferredOriginalPath)}). Displaying structure based on the masked file.`);
          }
        } else {
          console.warn(`Masked schema ${filePath} references selection file ${selectionFileName}, but it was not found.`);
          vscode.window.showWarningMessage(`Could not load the selection configuration file (${selectionFileName}) associated with this masked schema.`);
          // Proceed as if it's a new mask based on the _m1 file content
        }
      } else {
         console.log(`File ${filePath} has the suffix but no 'x-mask-selection' property. Treating as regular schema.`);
      }
    }
  } catch (error: any) {
    console.error(`Error checking for existing mask or loading config: ${error.message}`);
    vscode.window.showErrorMessage(`Error loading mask configuration: ${error.message}`);
    // Fallback to treating it as a new mask
    isExistingMask = false;
    initialSelection = undefined;
    initialOutputDir = undefined;
    originalSchemaPathForPayload = filePath;
  }
  // --- End check ---


  // If we already have a panel, show it and potentially update content
  if (currentPanel) {
    if (currentFilePath !== filePath) {
      // Always update the path being tracked
      currentFilePath = filePath;
      currentPanel.title = `Mask Editor: ${path.basename(filePath)}`; // Update title

      // Post a message to the webview to clear existing state before loading new data
      currentPanel.webview.postMessage({ type: 'clearState' });

      // Generate payload based on the determined path (original or masked)
      generatePayload(originalSchemaPathForPayload)
        .then(dataModelPayload => {
          const currentTheme = getThemeName(vscode.window.activeColorTheme.kind);
          // Send theme and payload
          currentPanel?.webview.postMessage({ type: 'setTheme', theme: currentTheme });
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: dataModelPayload });

          // If it was an existing mask, send the initial state *after* the payload
          if (isExistingMask && initialSelection) {
            console.log("Sending initial mask state to existing panel.");
            currentPanel?.webview.postMessage({
              type: 'setInitialMaskState',
              selection: initialSelection,
              outputDir: initialOutputDir // Send undefined if not found in config
            });
          }
        })
        .catch(error => {
          console.error('Error generating dataModelPayload for existing panel:', error);
          vscode.window.showErrorMessage(`Error loading schema: ${error.message}`);
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: null });
        });
    }
    currentPanel.reveal(column);
    return;
  }

  // Otherwise, create a new panel.
  currentFilePath = filePath; // Store the path for the new panel
  const panel = vscode.window.createWebviewPanel(
    'dataModelMasking',
    `Mask Editor: ${path.basename(filePath)}`,
    column || vscode.ViewColumn.One,
    {
      enableScripts: true,
      // IMPORTANT: Adjust if your build output folder changed (e.g., from 'dist' to 'build')
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview-ui', 'build')]
    }
  );
  currentPanel = panel;

  panel.webview.html = getHtmlForWebview(panel.webview, extensionUri); // Use the correct function name

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage(async (data) => {
    console.log(`Received message in extension host: Type: ${data?.type}`);
    switch (data.type) {
      case 'ready': {
        console.log(`Webview is ready! Sending initial payload for: ${originalSchemaPathForPayload}`);
        if (!currentFilePath) { // Should use currentFilePath for context check
          console.error("Cannot send dataModelPayload: currentFilePath is missing.");
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: null });
          return;
        }
        try {
          // Generate payload based on the determined path (original or masked)
          const dataModelPayload = await generatePayload(originalSchemaPathForPayload);
          const currentTheme = getThemeName(vscode.window.activeColorTheme.kind);
          console.log(`Sending initial theme: ${currentTheme}`);

          // Send theme and payload
          currentPanel?.webview.postMessage({ type: 'setTheme', theme: currentTheme });
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: dataModelPayload });

          // If it's an existing mask, send the initial state *after* the payload
          if (isExistingMask && initialSelection) {
            console.log("Sending initial mask state to new panel.");
            currentPanel?.webview.postMessage({
              type: 'setInitialMaskState',
              selection: initialSelection,
              outputDir: initialOutputDir // Send undefined if not found in config
            });
          }
        } catch (error: any) {
          console.error('Error generating dataModelPayload:', error);
          vscode.window.showErrorMessage(`Error loading schema: ${error.message}`);
          currentPanel?.webview.postMessage({ type: 'dataModelPayload', data: null });
        }
        break;
      }
      case 'create-mask': {
        console.log(`Create Mask Message Received: Content length ${data?.content?.length}`);
        if (!currentFilePath) {
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
          // Pass the *currently opened file path* as context for generateMask
          // generateMask internally resolves the mainSchemaId from the payload relative to this context.
          await generateMask(data.content, currentFilePath);
        } catch (error: any) {
          console.error('Error creating masks:', error);
          vscode.window.showErrorMessage(`Error creating masks: ${error.message}`);
        }
        break;
      }
      case 'selectOutputDirectory': {
        console.log("Received request to select output directory.");
        try {
          const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: 'Select Output Folder',
          };
          const result = await vscode.window.showOpenDialog(options);
          if (result && result.length > 0) {
            const selectedFolderPath = result[0].fsPath;
            console.log(`Folder selected: ${selectedFolderPath}`);
            panel?.webview.postMessage({ type: 'setOutputDirectory', path: selectedFolderPath });
          } else {
            console.log("Folder selection cancelled by user.");
          }
        } catch (error: any) {
          console.error('Error showing open dialog:', error);
          vscode.window.showErrorMessage(`Error selecting folder: ${error.message}`);
        }
        break;
      }
      default:
        console.log(`Received unhandled message type: ${data.type}`);
        break;
    }
  });

  // Handle panel disposal
  panel.onDidDispose(() => {
    currentPanel = undefined;
    currentFilePath = undefined;
  }, null, context.subscriptions);
}

// --- getHtmlForWebview, getDistFileUris, getNonce remain the same ---
// Make sure getHtmlForWebview references the correct build folder ('build' in your case)
// and includes the necessary <script> and potentially <link rel="stylesheet"> tags.

function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  console.log(`getHtmlForWebview() method`);
  // Assuming getDistFileUris correctly finds files in 'webview-ui/build/static/...'
  const { scriptUri, styleUri } = getDistFileUris(webview, extensionUri);
  console.log(`scriptUri: ${scriptUri}`);
  console.log(`styleUri: ${styleUri}`);
  const nonce = getNonce();

  // Ensure CSP allows styles from styleUri
  // Ensure the script tag uses the correct nonce and type="module" if needed by your build
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <!-- CSP updated to allow inline styles and styles from webview source -->
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <title>Mask Editor</title>
      </head>
      <body>
        <div id="root"></div>
        <!-- Ensure type="module" if your build requires it -->
        <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
      </body>
    </html>
  `;
}

// Make sure this function points to your actual build output ('build' not 'dist')
function getDistFileUris(webview: vscode.Webview, extensionUri: vscode.Uri) {
  const buildPath = path.join(extensionUri.fsPath, 'webview-ui', 'build'); // Use 'build'
  const scriptDistPath = path.join(buildPath, 'static', 'js');
  const styleDistPath = path.join(buildPath, 'static', 'css');

  if (!fs.existsSync(scriptDistPath) || !fs.existsSync(styleDistPath)) {
      console.error(`Build directories not found: ${scriptDistPath} or ${styleDistPath}`);
      throw new Error(`Could not find webview build directories. Ensure the webview UI is built correctly.`);
  }

  const scriptFiles = fs.readdirSync(scriptDistPath);
  const styleFiles = fs.readdirSync(styleDistPath);

  // Adjust regex if your build names files differently (e.g., includes hashes)
  const scriptFile = scriptFiles.find(file => file.startsWith('main.') && file.endsWith('.js'));
  const styleFile = styleFiles.find(file => file.startsWith('main.') && file.endsWith('.css'));

  if (!scriptFile) {
    console.error(`Could not find main.*.js script file in ${scriptDistPath}`);
    throw new Error('Could not find main webview script file.');
  }
  if (!styleFile) {
    console.error(`Could not find main.*.css style file in ${styleDistPath}`);
    // If CSS isn't critical, you could potentially continue without it, but better to fix the build/path
    throw new Error('Could not find main webview style file.');
  }

  console.log(`Found script: ${scriptFile}, style: ${styleFile}`);

  // Correct path segments for getUri
  const scriptUri = getUri(webview, extensionUri, ['webview-ui', 'build', 'static', 'js', scriptFile]);
  const styleUri = getUri(webview, extensionUri, ['webview-ui', 'build', 'static', 'css', styleFile]);

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

export function deactivate() {}
