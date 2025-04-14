// webview-ui/src/App.tsx
import React, { useState, useCallback, useEffect, useRef } from 'react'; // Add useRef
import { Schema, SelectionState, SelectionValue, SchemaPayload } from './types'; // Use local types
import SchemaNode from './components/SchemaNode';
import OutputGenerator from './components/OutputGenerator';
import './App.css';
import { setDeepValue } from './utils/schemaUtils';

// --- MUI Imports ---
import { ThemeProvider, createTheme, CssBaseline, Typography } from '@mui/material';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
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
const lightTheme = createTheme({ palette: { mode: 'light' } });
const darkTheme = createTheme({ palette: { mode: 'dark' } });
// --- End MUI Themes ---

const DEFAULT_OUTPUT_DIR = 'generated_schemas'; // Define default

function App() {
  const [allSchemas, setAllSchemas] = useState<{ [id: string]: Schema } | null>(null);
  const [mainSchemaId, setMainSchemaId] = useState<string | null>(null);
  const [mainSchemaBasePath, setMainSchemaBasePath] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [selectionState, setSelectionState] = useState<SelectionState | undefined>(undefined);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');
  const [outputDir, setOutputDir] = useState<string>(DEFAULT_OUTPUT_DIR);

  // Ref to track if initial state was just set, to prevent dataModelPayload from resetting it
  const initialStateJustSet = useRef(false);

  useEffect(() => {
    const applyThemeToBody = (theme: 'light' | 'dark') => {
      document.body.classList.remove('light', 'dark');
      document.body.classList.add(theme);
    };
    applyThemeToBody(themeMode);

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      console.log(`New message in webview: ${JSON.stringify(message?.type)}`);
      switch (message.type) {
        case 'dataModelPayload':
          try {
            const payload: SchemaPayload | null = typeof message.data === 'string'
              ? JSON.parse(message.data)
              : message.data;
            console.log(`Received payload:`, payload);
            if (payload && payload.schemas && payload.mainSchemaId) {
              setAllSchemas(payload.schemas);
              setMainSchemaId(payload.mainSchemaId);
              setMainSchemaBasePath(payload.mainSchemaBasePath || null);
              setError('');

              // Reset selection/outputDir ONLY if we didn't just load initial state
              if (!initialStateJustSet.current) {
                 console.log("Resetting selection and outputDir for new payload.");
                 setSelectionState(undefined);
                 setOutputDir(DEFAULT_OUTPUT_DIR);
              } else {
                 console.log("Skipping selection/outputDir reset after initial state load.");
              }
              // Reset the flag after processing
              initialStateJustSet.current = false;

              console.log(`State updated: mainSchemaId=${payload.mainSchemaId}`);
            } else {
               console.warn("Received null or invalid dataModelPayload", payload);
               setAllSchemas(null);
               setMainSchemaId(null);
               setMainSchemaBasePath(null);
               setError('Received invalid schema data.');
               setSelectionState(undefined);
               setOutputDir(DEFAULT_OUTPUT_DIR);
            }
          } catch (e) {
             console.error("Error processing dataModelPayload:", e, "Raw data:", message.data);
             setError(`Error processing schema data: ${e instanceof Error ? e.message : String(e)}`);
             setAllSchemas(null);
             setMainSchemaId(null);
             setMainSchemaBasePath(null);
             setSelectionState(undefined);
             setOutputDir(DEFAULT_OUTPUT_DIR);
          }
          break;

        // --- Handler for initial mask state ---
        case 'setInitialMaskState':
          if (message.selection) {
            console.log("Received initial mask state:", message);
            setSelectionState(message.selection);
            // Set outputDir only if provided and valid, otherwise keep default
            if (typeof message.outputDir === 'string' && message.outputDir.trim() !== '') {
                setOutputDir(message.outputDir);
            } else {
                setOutputDir(DEFAULT_OUTPUT_DIR); // Fallback if not provided or empty
            }
            // Set the flag to prevent dataModelPayload reset
            initialStateJustSet.current = true;
          } else {
            console.warn("Received setInitialMaskState message without valid selection data.");
          }
          break;

        case 'setTheme':
          const newTheme = message.theme === 'dark' ? 'dark' : 'light';
          setThemeMode(newTheme);
          applyThemeToBody(newTheme);
          break;
        case 'clearState':
           console.log("Received clearState message");
           setAllSchemas(null);
           setMainSchemaId(null);
           setMainSchemaBasePath(null);
           setError('');
           setSelectionState(undefined);
           setOutputDir(DEFAULT_OUTPUT_DIR);
           initialStateJustSet.current = false; // Reset flag on clear
           break;
        case 'setOutputDirectory':
            if (message.path && typeof message.path === 'string') {
                setOutputDir(message.path);
            } else {
                console.warn("Received invalid setOutputDirectory message:", message);
            }
            break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
    console.log("Webview ready message sent.");

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []); // Run only once on mount

  useEffect(() => {
      document.body.classList.remove('light', 'dark');
      document.body.classList.add(themeMode);
  }, [themeMode]);


  const handleCreateMask = useCallback((selectionPayload: string) => {
    console.log(`App.tsx: handleCreateMask called with payload length: ${selectionPayload.length}`)
    vscode.postMessage({ type: 'create-mask', content: selectionPayload });
  }, []);

  const handleToggle = useCallback((path: (string | number)[], newValue: SelectionValue) => {
    setSelectionState(prevState => {
        try {
            const newState = setDeepValue(prevState, path, newValue);
            return newState;
        } catch (error) {
            console.error("[handleToggle] Error during setDeepValue:", error);
            setError(`Error updating selection: ${error instanceof Error ? error.message : String(error)}`);
            return prevState;
        }
    });
  }, []);

  const handleOutputDirChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setOutputDir(event.target.value);
  };

  const handleBrowseClick = () => {
    vscode.postMessage({ type: 'selectOutputDirectory' });
  };

  const mainSchema = allSchemas && mainSchemaId ? allSchemas[mainSchemaId] : null;
  const muiTheme = themeMode === 'dark' ? darkTheme : lightTheme;

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <Box className={`App ${themeMode}`} sx={{ p: 2, height: '100vh', display: 'flex', flexDirection: 'column' }}>

        {error && <Typography color="error" sx={{ mb: 2, flexShrink: 0 }}>Error: {error}</Typography>}

        {!mainSchema && !error && (
             <Typography color="text.secondary" sx={{ flexShrink: 0 }}>Loading schema or waiting for data...</Typography>
        )}

        {mainSchema && mainSchemaId && allSchemas && (
          <Grid container spacing={2} direction="column" sx={{ flexGrow: 1, overflow: 'hidden', textAlign: 'left' }}>
            {/* Top Section: Schema Tree + Output Controls */}
            <Grid item xs={12} sx={{ overflowY: 'auto', flexShrink: 1 }}>
               <Typography variant="h5" component="h2" gutterBottom>
                   Mask Editor: {mainSchemaId} {/* Consider showing original name if inferred */}
               </Typography>
               <SchemaNode
                 schema={mainSchema}
                 selection={selectionState} // Pass the potentially pre-filled state
                 onToggle={handleToggle}
                 path={[]}
                 isRoot={true}
                 allSchemas={allSchemas}
                 currentSchemaId={mainSchemaId}
                 renderedAncestorIds={new Set([mainSchemaId])}
               />

               {/* Output Directory Input and Browse Button */}
               <Box sx={{ my: 2, display: 'flex', alignItems: 'center' }}>
                 <TextField
                   label="Output Directory"
                   variant="outlined"
                   size="small"
                   value={outputDir} // Use the potentially pre-filled state
                   onChange={handleOutputDirChange}
                   placeholder={DEFAULT_OUTPUT_DIR}
                   sx={{ mr: 1, flexGrow: 1 }}
                 />
                 <Button variant="outlined" size="medium" onClick={handleBrowseClick} sx={{ flexShrink: 0 }}>
                   Browse...
                 </Button>
               </Box>

               {/* Output Generator Component */}
               <OutputGenerator
                 selectionState={selectionState} // Pass the potentially pre-filled state
                 mainSchemaFileName={mainSchemaId}
                 mainSchemaBasePath={mainSchemaBasePath}
                 outputDir={outputDir || DEFAULT_OUTPUT_DIR} // Use the potentially pre-filled state
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
