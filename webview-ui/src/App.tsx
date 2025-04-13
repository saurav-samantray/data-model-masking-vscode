// src/App.tsx
import React, { useState, useCallback, useEffect } from 'react';
import { Schema, SelectionState, SelectionValue, SchemaPayload } from './types';
import SchemaNode from './components/SchemaNode';
import OutputGenerator from './components/OutputGenerator';
import './App.css'; // Keep general styles
import { setDeepValue } from './utils/schemaUtils';

// --- MUI Imports ---
import { ThemeProvider, createTheme, CssBaseline, Typography, TextField, Button } from '@mui/material';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid'; // For layout
// --- End MUI Imports ---

// Define a type for the VS Code API
interface VsCodeApi {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
}

declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

// --- Define MUI Themes ---
const lightTheme = createTheme({
  palette: {
    mode: 'light',
    // Add custom overrides here if needed
  },
  // Adjust spacing or typography if desired
});

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    // Add custom overrides here if needed
  },
});
// --- End MUI Themes ---

const DEFAULT_OUTPUT_DIR = 'generated_schemas'; // Define default

function App() {
  const [allSchemas, setAllSchemas] = useState<{ [id: string]: Schema } | null>(null);
  const [mainSchemaId, setMainSchemaId] = useState<string | null>(null);
  const [mainSchemaBasePath, setMainSchemaBasePath] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [selectionState, setSelectionState] = useState<SelectionState | undefined>(undefined);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light'); // Default to light
  const [outputDir, setOutputDir] = useState<string>(DEFAULT_OUTPUT_DIR); // State for output directory

  useEffect(() => {
    // Function to apply theme class to body
    const applyThemeToBody = (theme: 'light' | 'dark') => {
      document.body.classList.remove('light', 'dark');
      document.body.classList.add(theme);
      console.log(`Applied theme to body: ${theme}`);
    };

    // Apply initial theme based on state
    applyThemeToBody(themeMode);

    // Setup message listener
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      console.log(`New message in webview: ${JSON.stringify(message?.type)}`); // Log only type initially
      switch (message.type) {
        case 'dataModelPayload':
          try {
            // Check if data is already an object or needs parsing
            const payload: SchemaPayload | null = typeof message.data === 'string'
              ? JSON.parse(message.data)
              : message.data;

            console.log(`Received payload:`, payload); // Log the parsed payload

            if (payload && payload.schemas && payload.mainSchemaId) {
              setAllSchemas(payload.schemas);
              setMainSchemaId(payload.mainSchemaId);
              setMainSchemaBasePath(payload.mainSchemaBasePath || null); // Handle potentially missing basePath
              setError('');
              setSelectionState(undefined); // Reset selection
              setOutputDir(DEFAULT_OUTPUT_DIR); // Reset output dir on new payload
              console.log(`State updated: mainSchemaId=${payload.mainSchemaId}`);
            } else {
               console.warn("Received null or invalid dataModelPayload", payload);
               // Clear state if payload is invalid/null
               setAllSchemas(null);
               setMainSchemaId(null);
               setMainSchemaBasePath(null);
               setError('Received invalid schema data.');
               setSelectionState(undefined);
            }
          } catch (e) {
             console.error("Error processing dataModelPayload:", e, "Raw data:", message.data);
             setError(`Error processing schema data: ${e instanceof Error ? e.message : String(e)}`);
             // Clear state on error
             setAllSchemas(null);
             setMainSchemaId(null);
             setMainSchemaBasePath(null);
             setSelectionState(undefined);
          }
          break;
        case 'setTheme':
          const newTheme = message.theme === 'dark' ? 'dark' : 'light';
          console.log(`Received theme: ${newTheme}`);
          setThemeMode(newTheme);
          applyThemeToBody(newTheme); // Apply class immediately
          break;
        case 'setOutputDirectory':
          console.log(`Received output directory: ${message.path}`);
          setOutputDir(message.path);  // Update state
          break;
        case 'clearState': // Handle state clearing if panel is reused
           console.log("Received clearState message");
           setAllSchemas(null);
           setMainSchemaId(null);
           setMainSchemaBasePath(null);
           setError('');
           setSelectionState(undefined);
           setOutputDir(DEFAULT_OUTPUT_DIR); // Reset output dir
           break;
      }
    };

    window.addEventListener('message', handleMessage);

    // Signal readiness to the extension host
    vscode.postMessage({ type: 'ready' });
    console.log("Webview ready message sent.");

    // Cleanup listener on component unmount
    return () => {
      window.removeEventListener('message', handleMessage);
      console.log("Webview message listener removed.");
    };
  }, []); // Run only once on mount

  // Update body class when themeMode state changes (redundant with immediate application, but safe)
  useEffect(() => {
      document.body.classList.remove('light', 'dark');
      document.body.classList.add(themeMode);
  }, [themeMode]);


  const handleCreateMask = useCallback((selectionPayload: string) => { // Ensure type is string
    console.log(`App.tsx: handleCreateMask called with: ${selectionPayload}`)
    vscode.postMessage({ type: 'create-mask', content: selectionPayload });
  }, []); // No dependencies needed if vscode is stable

  const handleToggle = useCallback((path: (string | number)[], newValue: SelectionValue) => {
    console.log("[handleToggle] Received:", { path, newValue });
    setSelectionState(prevState => {
        try {
            const newState = setDeepValue(prevState, path, newValue);
            console.log("[handleToggle] newState:", JSON.stringify(newState));
            return newState;
        } catch (error) {
            console.error("[handleToggle] Error during setDeepValue:", error);
            setError(`Error updating selection: ${error instanceof Error ? error.message : String(error)}`);
            return prevState;
        }
    });
  }, []); // Dependencies removed as they seemed unrelated to the previous issue

  // Handler for output directory input change
  const handleOutputDirChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setOutputDir(event.target.value);
  };

  // Handler for Browse button click ---
  const handleBrowseClick = () => {
    console.log("Browse button clicked, sending message to extension host.");
    vscode.postMessage({ type: 'selectOutputDirectory' });
  };

  // Get the actual main schema object to render
  const mainSchema = allSchemas && mainSchemaId ? allSchemas[mainSchemaId] : null;
  const muiTheme = themeMode === 'dark' ? darkTheme : lightTheme;

  return (
    // Apply MUI Theme Provider and CssBaseline
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      {/* Use Box for consistent padding/margin respecting theme */}
      <Box className={`App ${themeMode}`} sx={{ p: 2, height: '100vh', display: 'flex', flexDirection: 'column' }}>

        {error && <Typography color="error" sx={{ mb: 2 }}>Error: {error}</Typography>}

        {!mainSchema && !error && (
             <Typography color="text.secondary">Loading schema or waiting for data...</Typography>
        )}

        {mainSchema && mainSchemaId && allSchemas && (
          // Use Grid for layout
          <Grid container spacing={2} sx={{ flexGrow: 1, overflow: 'auto' }}>
            {/* Schema Tree Column */}
            {/* Top Section: Schema Tree + Output Generator */}
            {/* Grid Item 1: Full width, allows vertical scrolling for its content */}
            <Grid item xs={12} sx={{ overflowY: 'auto', flexShrink: 1 /* Allow shrinking if needed, prevents pushing preview off */ }}>
               <Typography variant="h5" component="h2" gutterBottom>
                   Mask Editor: {mainSchemaId}
               </Typography>
               <SchemaNode
                 schema={mainSchema}
                 selection={selectionState}
                 onToggle={handleToggle}
                 path={[]}
                 isRoot={true}
                 allSchemas={allSchemas}
                 currentSchemaId={mainSchemaId}
                 renderedAncestorIds={new Set([mainSchemaId])}
               />
               {/* Add Output Directory Input */}
               <Box sx={{ my: 2, display: 'flex', alignItems: 'center' }}> {/* Use flexbox */}
                 <TextField
                   label="Output Directory"
                   variant="outlined"
                   size="small"
                   //fullWidth
                   value={outputDir}
                   onChange={handleOutputDirChange}
                   placeholder={DEFAULT_OUTPUT_DIR}
                   sx={{ mr: 1, flexGrow: 1 }} // Add margin right, allow text field to grow
                 />
                 <Button
                   variant="outlined"
                   size="medium" // Match TextField height better
                   onClick={handleBrowseClick}
                   sx={{ flexShrink: 0 }} // Prevent button from shrinking
                 >
                   Browse...
                 </Button>
               </Box>
               {/* Output Generator Component */}
               <OutputGenerator
                 selectionState={selectionState}
                 mainSchemaFileName={mainSchemaId}
                 mainSchemaBasePath={mainSchemaBasePath}
                 outputDir={outputDir || DEFAULT_OUTPUT_DIR} // Pass state, fallback to default if empty
                 handleCreateMask={handleCreateMask}
               />
            </Grid>
          </Grid>
        )}
      </Box>
    </ThemeProvider>
  );
}

export default App;
