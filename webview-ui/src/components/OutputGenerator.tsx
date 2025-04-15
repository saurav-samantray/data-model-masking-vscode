// c:\workspace\apicurio\data-model-masking-vscode\webview-ui\src\components\OutputGenerator.tsx
import React, { useState, useEffect } from 'react';
import { SelectionState } from '../types';
import { Button, TextField, Box, Typography } from '@mui/material';

interface OutputGeneratorProps {
    selectionState: SelectionState | undefined;
    mainSchemaFileName: string | null;
    mainSchemaBasePath: string | null;
    outputDir: string;
    // *** CHANGE: Update handleCreateMask prop type to accept the full payload object ***
    handleCreateMask: (payload: Record<string, any>) => void;
}

// Define a default suffix
const DEFAULT_MASK_SUFFIX = '.m1'; // Default suffix for the mask file

const OutputGenerator: React.FC<OutputGeneratorProps> = ({
    selectionState,
    mainSchemaFileName,
    mainSchemaBasePath,
    outputDir,
    handleCreateMask
}) => {
    // *** ADD: State for the mask suffix input ***
    const [maskSuffix, setMaskSuffix] = useState<string>(DEFAULT_MASK_SUFFIX);

    // Reset suffix if the main schema changes (optional but good practice)
    useEffect(() => {
        setMaskSuffix(DEFAULT_MASK_SUFFIX);
    }, [mainSchemaFileName]);

    // *** ADD: Handler for suffix input change ***
    const handleSuffixChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setMaskSuffix(event.target.value);
    };

    const generateOutputFile = () => {
        if (!selectionState) {
            alert("No selection has been made yet.");
            return;
        }
        if (!mainSchemaFileName) {
            alert("Cannot generate output: Main schema ID is missing.");
            return;
        }
        // *** ADD: Validation for empty suffix ***
        if (!maskSuffix.trim()) {
            alert("Mask file suffix cannot be empty.");
            return;
        }

        // Construct the final output object structure, including the suffix
        const outputData = {
            mainSchemaId: mainSchemaFileName,
            mainSchemaBasePath: mainSchemaBasePath,
            outputDir: outputDir,
            selection: selectionState,
            // *** ADD: Include the suffix from state ***
            maskSuffix: maskSuffix.trim(),
        };

        // --- Download selection.json locally (optional, for debugging/backup) ---
        // This part remains unchanged
        const jsonString = JSON.stringify(outputData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'selection_payload.json';
        document.body.appendChild(link);
        // link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        // --- End optional download ---

        console.log(`Calling handleCreateMask with payload:`, outputData);
        // *** CHANGE: Pass the entire object to the handler ***
        handleCreateMask(outputData);
    };

    return (
        <Box sx={{
            marginTop: theme => theme.spacing(2.5),
            borderTop: '1px solid var(--vscode-editorWidget-border, #ccc)',
            paddingTop: theme => theme.spacing(1.5),
            display: 'flex',
            flexDirection: 'column',
            gap: theme => theme.spacing(1.5)
        }}>
             <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
                Generate Mask File
            </Typography>
            {/* *** ADD: TextField for Mask Suffix *** */}
            <TextField
                label="Mask Version Suffix"
                variant="outlined"
                size="small"
                value={maskSuffix}
                onChange={handleSuffixChange}
                helperText="Version Suffix added before the extension (e.g., .m1, .m2 etc)"
                fullWidth // Take full width
                disabled={!selectionState || !mainSchemaFileName} // Disable if no schema/selection
            />
            <Button
                variant="contained"
                size="medium"
                onClick={generateOutputFile}
                // *** CHANGE: Also disable if suffix is empty ***
                disabled={!selectionState || !mainSchemaFileName || !maskSuffix.trim()}
                sx={{ alignSelf: 'flex-start' }}
            >
                Generate Mask
            </Button>
        </Box>
    );
};

export default OutputGenerator;
