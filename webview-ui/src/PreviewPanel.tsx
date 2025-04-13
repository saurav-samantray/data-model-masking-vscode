// src/components/PreviewPanel.tsx
import React, { useState, useEffect } from 'react';
import { Schema, SchemaDefinition, SelectionValue, SchemaMap } from '../types';
import { resolveRefUri, getSelectionValue } from '../utils/schemaUtils';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';

interface PreviewPanelProps {
  selectionState: SelectionValue | undefined;
  allSchemas: SchemaMap;
  mainSchemaId: string | undefined;
}

/**
 * Recursively generates a preview schema based on the selection state.
 */
const generatePreviewSchema = (
  originalSchemaDef: SchemaDefinition | undefined,
  selection: SelectionValue | undefined,
  currentSchemaId: string,
  allSchemas: SchemaMap,
  ancestorIds: Set<string> = new Set()
): Schema | undefined => {
  if (!originalSchemaDef || selection === undefined || selection === false) {
    return undefined; // Not selected or schema missing
  }

  // Handle boolean schemas (though less common for complex structures)
  if (typeof originalSchemaDef === 'boolean') {
    return selection === true ? {} : undefined; // Represent selected boolean schema as empty object for simplicity
  }

  const originalSchema = originalSchemaDef as Schema; // Cast after boolean check

  // --- Handle $ref ---
  if (originalSchema.$ref) {
    const { resolvedSchema, resolvedSchemaId, error } = resolveRefUri(
      originalSchema.$ref,
      currentSchemaId,
      allSchemas
    );

    if (error || !resolvedSchema || !resolvedSchemaId) {
      console.error(`[generatePreviewSchema] Error resolving $ref ${originalSchema.$ref}: ${error}`);
      // Optionally return a schema indicating the error
      return { description: `Error resolving $ref: ${originalSchema.$ref}` };
    }

    // --- Circular Reference Check ---
    if (ancestorIds.has(resolvedSchemaId)) {
      // Return a simple $ref representation to avoid infinite loops
      return { $ref: originalSchema.$ref, description: '(Circular Reference)' };
    }

    const newAncestorIds = new Set([...ancestorIds, currentSchemaId]); // Track current path

    // If the entire ref node is selected (selection === true)
    if (selection === true) {
      // We need to generate the *entire* target schema, but prevent infinite loops
      return generatePreviewSchema(resolvedSchema, true, resolvedSchemaId, allSchemas, newAncestorIds);
    }

    // If specific parts of the ref target are selected (selection is an object)
    if (typeof selection === 'object' && selection !== null && '$refTargetSelection' in selection) {
       // Generate preview based on the *target* schema and the $refTargetSelection part
       return generatePreviewSchema(
         resolvedSchema,
         selection.$refTargetSelection,
         resolvedSchemaId,
         allSchemas,
         newAncestorIds
       );
    }

    // If the $ref itself is selected but not its target content (shouldn't happen with current toggle logic, but handle defensively)
    return undefined;
  }

  // --- Handle non-$ref schemas (object, array, primitive) ---

  // If the entire node is selected (selection === true)
  if (selection === true) {
    // Return a deep copy of the original schema, resolving nested refs carefully
    const copySchema = JSON.parse(JSON.stringify(originalSchema)) as Schema; // Basic deep copy

    // Recursively process properties if it's an object
    if (copySchema.type === 'object' && copySchema.properties) {
      const newProperties: { [key: string]: Schema } = {};
      for (const key in copySchema.properties) {
        const propSchema = generatePreviewSchema(
          copySchema.properties[key],
          true, // Select everything underneath
          currentSchemaId,
          allSchemas,
          new Set([...ancestorIds, currentSchemaId]) // Pass down ancestor tracking
        );
        if (propSchema) {
          newProperties[key] = propSchema;
        }
      }
      copySchema.properties = newProperties;
    }

    // Recursively process items if it's an array
    if (copySchema.type === 'array' && copySchema.items && typeof copySchema.items === 'object') {
       const itemsSchema = generatePreviewSchema(
         copySchema.items as Schema,
         true, // Select everything underneath
         currentSchemaId,
         allSchemas,
         new Set([...ancestorIds, currentSchemaId]) // Pass down ancestor tracking
       );
       if (itemsSchema) {
         copySchema.items = itemsSchema;
       } else {
         delete copySchema.items; // Remove items if they couldn't be generated
       }
    }

    return copySchema;
  }

  // If specific children are selected (selection is an object)
  if (typeof selection === 'object' && selection !== null) {
    const resultSchema: Schema = {
      // Copy basic metadata
      ...(originalSchema.title && { title: originalSchema.title }),
      ...(originalSchema.description && { description: originalSchema.description }),
      type: originalSchema.type,
    };

    // --- Handle Object Properties ---
    if (originalSchema.type === 'object' && originalSchema.properties) {
      const selectedProperties = getSelectionValue(selection, 'properties');
      if (typeof selectedProperties === 'object' && selectedProperties !== null) {
        const newProperties: { [key: string]: Schema } = {};
        const requiredProperties: string[] = [];

        for (const key in selectedProperties) {
          if (originalSchema.properties[key]) {
            const propSelection = selectedProperties[key];
            const generatedPropSchema = generatePreviewSchema(
              originalSchema.properties[key],
              propSelection,
              currentSchemaId,
              allSchemas,
              new Set([...ancestorIds, currentSchemaId])
            );

            if (generatedPropSchema) {
              newProperties[key] = generatedPropSchema;
              // If the original schema had this property as required, keep it required
              if (originalSchema.required?.includes(key)) {
                requiredProperties.push(key);
              }
            }
          }
        }

        if (Object.keys(newProperties).length > 0) {
          resultSchema.properties = newProperties;
          if (requiredProperties.length > 0) {
            // Only include required if there are properties and some were originally required
            resultSchema.required = requiredProperties;
          }
        }
      }
    }

    // --- Handle Array Items ---
    if (originalSchema.type === 'array' && originalSchema.items) {
      const itemsSelection = getSelectionValue(selection, 'items');
      if (itemsSelection !== undefined && typeof originalSchema.items === 'object') { // Ensure items schema is an object
        const generatedItemsSchema = generatePreviewSchema(
          originalSchema.items as Schema,
          itemsSelection,
          currentSchemaId,
          allSchemas,
          new Set([...ancestorIds, currentSchemaId])
        );
        if (generatedItemsSchema) {
          resultSchema.items = generatedItemsSchema;
        }
      } else if (itemsSelection === true && typeof originalSchema.items !== 'object') {
         // Handle simple array items (e.g., "items": { "type": "string" }) when fully selected
         resultSchema.items = JSON.parse(JSON.stringify(originalSchema.items));
      }
    }

    // Only return the schema if it has properties or items (or is a primitive type that was selected)
    if (resultSchema.properties || resultSchema.items || (originalSchema.type !== 'object' && originalSchema.type !== 'array')) {
       return resultSchema;
    }
  }

  // Default: nothing generated for this path/selection combination
  return undefined;
};


const PreviewPanel: React.FC<PreviewPanelProps> = ({
  selectionState,
  allSchemas,
  mainSchemaId,
}) => {
  const [previewSchema, setPreviewSchema] = useState<Schema | null | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mainSchemaId || !allSchemas || Object.keys(allSchemas).length === 0) {
      setPreviewSchema(undefined);
      setError('Schema data not available.');
      return;
    }

    if (selectionState === undefined) {
        setPreviewSchema(null); // Represent no selection as null (empty preview)
        setError(null);
        setIsLoading(false);
        return;
    }


    setIsLoading(true);
    setError(null);

    // Use a timeout to allow UI to update before potentially heavy computation
    const timer = setTimeout(() => {
        try {
            const mainSchema = allSchemas[mainSchemaId];
            if (!mainSchema) {
                throw new Error(`Main schema "${mainSchemaId}" not found.`);
            }
            const generated = generatePreviewSchema(
                mainSchema,
                selectionState,
                mainSchemaId,
                allSchemas,
                new Set() // Start with empty ancestor set
            );
            setPreviewSchema(generated);
        } catch (err) {
            console.error("Error generating preview schema:", err);
            setError(err instanceof Error ? err.message : 'An unknown error occurred during preview generation.');
            setPreviewSchema(undefined);
        } finally {
            setIsLoading(false);
        }
    }, 50); // Short delay

    return () => clearTimeout(timer); // Cleanup timer on effect change

  }, [selectionState, allSchemas, mainSchemaId]);

  const renderContent = () => {
    if (isLoading) {
      return <CircularProgress size={24} sx={{ display: 'block', margin: '20px auto' }} />;
    }
    if (error) {
      return <Typography color="error">Error: {error}</Typography>;
    }
    if (previewSchema === undefined) {
       return <Typography color="text.secondary">Load a schema and make selections to see the preview.</Typography>;
    }
     if (previewSchema === null) {
       return <Typography color="text.secondary">No properties selected.</Typography>;
     }

    try {
      return (
        <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', margin: 0, fontSize: '0.8rem' }}>
          {JSON.stringify(previewSchema, null, 2)}
        </pre>
      );
    } catch (err) {
      return <Typography color="error">Error displaying preview JSON.</Typography>;
    }
  };

  return (
    <Paper elevation={2} sx={{ height: '100%', overflowY: 'auto', p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Preview Schema
      </Typography>
      <Box>
        {renderContent()}
      </Box>
    </Paper>
  );
};

export default PreviewPanel;
