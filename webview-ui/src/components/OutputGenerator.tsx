// src/components/OutputGenerator.tsx
import React from 'react';
import { SelectionState } from '../types';
import { Button } from '@mui/material';

interface OutputGeneratorProps {
  selectionState: SelectionState | undefined;
  mainSchemaFileName: string | null; // Changed to potentially null
  mainSchemaBasePath: string | null;
  outputDir: string;
  handleCreateMask: (selectionPayload: string) => void;
}

const OutputGenerator: React.FC<OutputGeneratorProps> = ({ selectionState, mainSchemaFileName, mainSchemaBasePath, outputDir, handleCreateMask }) => {

  const generateOutputFile = () => {
    if (!selectionState) {
      alert("No selection has been made yet.");
      return;
    }
    if (!mainSchemaFileName) {
      alert("Cannot generate output: Main schema ID is missing.");
      return;
    }

    // Construct the final output object structure
    const outputData = {
      // Use the mainSchemaId directly from the loaded payload
      mainSchemaId: mainSchemaFileName,
      mainSchemaBasePath: mainSchemaBasePath,
      outputDir: outputDir,
      selection: selectionState,
    };

    const jsonString = JSON.stringify(outputData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'selection.json'; // Fixed output filename
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    console.log(`handleCreateMask called with: ${jsonString}`);
    handleCreateMask(jsonString);
  };

  return (
    <div style={{ marginTop: '20px', borderTop: '1px solid #ccc', paddingTop: '10px' }}>
      <Button
        variant="contained"
        size="medium" // Match TextField height better
        onClick={generateOutputFile}
        disabled={!selectionState || !mainSchemaFileName}
        sx={{ flexShrink: 0 }} // Prevent button from shrinking
      >Generate Mask</Button>
    </div>
  );
};

export default OutputGenerator;
