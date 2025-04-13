// src/App.tsx
import React, { useState, useCallback, useEffect } from 'react';
import { Schema, SelectionState, SelectionValue, SchemaPayload } from './types';
// import FileLoader from './components/FileLoader'; // Remove FileLoader
import PayloadLoader from './components/PayloadLoader'; // Add PayloadLoader
import SchemaNode from './components/SchemaNode';
import OutputGenerator from './components/OutputGenerator';
import './App.css';
import { setDeepValue } from './utils/schemaUtils';

// Define a type for the VS Code API (optional, but good practice)
interface VsCodeApi {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
}

// Declare the acquireVsCodeApi function as a global variable
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();


function App() {
  // State for the loaded schemas and main ID
  const [allSchemas, setAllSchemas] = useState<{ [id: string]: Schema } | null>(null);
  const [mainSchemaId, setMainSchemaId] = useState<string | null>(null);
  const [mainSchemaBasePath, setMainSchemaBasePath] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [selectionState, setSelectionState] = useState<SelectionState | undefined>(undefined);

  useEffect(() => {
    if (typeof acquireVsCodeApi === 'function') {
      console.log("Default effect. Adding windows listener");
      console.log(`vscode: ${JSON.stringify(vscode)}`);

      window.addEventListener('message', event => {
        const message = event.data;
        console.log(`New message in webview: ${JSON.stringify(message)}`);
        switch (message.type) {
          case 'dataModelPayload':
            const payload: SchemaPayload  = JSON.parse(message.data);
            console.log(`payload: ${payload}`);
            setAllSchemas(payload.schemas);
            setMainSchemaId(payload.mainSchemaId);
            setMainSchemaBasePath(payload.mainSchemaBasePath);
            setError('');
            // Reset selection when a new payload is loaded
            setSelectionState(undefined);
            console.log(`allSchemas: ${JSON.stringify(payload.schemas)}`);
            console.log(`mainSchemaId: ${payload.mainSchemaId}`);
            break;
          case 'theme':
            //setTheme(message.data);
            break;
        }
      });

      vscode.postMessage({ type: 'ready' });
    } else {
      console.log("acquireVsCodeApi is undefined. Potentially webview is being run as standalone app.")
      //setStandalone(true);
      //setIsLoading(false);
    }
  }, []);

  const handleCreateMask = (selectionPayload: String) => {
    console.log(`App.tsx: handleCreateMask called with: ${selectionPayload}`)
    vscode.postMessage({ type: 'create-mask', content: selectionPayload });
  }

  const handleToggle = useCallback((path: (string | number)[], newValue: SelectionValue) => {
    console.log("[handleToggle] Received:", { path, newValue }); // Log input

    setSelectionState(prevState => {
        console.log("[handleToggle] prevState:", JSON.stringify(prevState)); // Log previous state
        try {
            const newState = setDeepValue(prevState, path, newValue);
            console.log("[handleToggle] newState:", JSON.stringify(newState)); // Log new state
            // --- Add check here ---
            if (newState === undefined && prevState !== undefined && path.length > 0) {
                console.warn("[handleToggle] Entire selection state became undefined!");
            }
            // --- End check ---
            return newState;
        } catch (error) {
            console.error("[handleToggle] Error during setDeepValue:", error);
            setError(`Error updating selection: ${error}`); // Update error state
            return prevState; // Return previous state on error to prevent crash/collapse
        }
    });

    // Log the other state variables AFTER the update cycle might have finished (using setTimeout)
    // This isn't guaranteed to be after the render, but helps check if they were somehow modified.
    setTimeout(() => {
        console.log("[handleToggle] Post-update check:", { mainSchemaId: mainSchemaId, allSchemasPresent: !!allSchemas });
    }, 0);

  }, [mainSchemaId, allSchemas]); // Add dependencies if needed, though likely not the cause here

  // Get the actual main schema object to render
  const mainSchema = allSchemas && mainSchemaId ? allSchemas[mainSchemaId] : null;

  return (
    <div className="App">

      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {/* Render SchemaNode if main schema is found */}
      {mainSchema && mainSchemaId && allSchemas && (
        <div style={{ marginTop: '20px', textAlign: 'left' }}>
          <h2>Mask Editor: {mainSchemaId}</h2>
          <SchemaNode
            schema={mainSchema}
            selection={selectionState}
            onToggle={handleToggle}
            path={[]}
            isRoot={true}
            allSchemas={allSchemas}
            currentSchemaId={mainSchemaId}
            // --- Pass initial ancestry ---
            renderedAncestorIds={new Set([mainSchemaId])} // Initialize with root ID
          />
          <OutputGenerator
             selectionState={selectionState}
             mainSchemaFileName={mainSchemaId}
             mainSchemaBasePath={mainSchemaBasePath}
             outputDir="generated_schemas"
             handleCreateMask={handleCreateMask}
          />
        </div>
      )}
    </div>
  );
}

export default App;
