// c:\workspace\apicurio\data-model-masking-vscode\webview-ui\src\components\SchemaNode.tsx
import React, { useMemo } from 'react';
import { Schema, SchemaDefinition, SelectionValue, SchemaMap } from '../types';
import { resolveRefUri, getSelectionValue, getCombinedProperties } from '../utils/schemaUtils';

// --- MUI Imports ---
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
// --- End MUI Imports ---

interface SchemaNodeProps {
  schema: SchemaDefinition;
  selection: SelectionValue | undefined;
  onToggle: (path: (string | number)[], newValue: SelectionValue) => void;
  path: (string | number)[];
  propertyName?: string;
  isRoot?: boolean;
  allSchemas: SchemaMap;
  currentSchemaId: string;
  renderedAncestorIds: Set<string>;
}

const SchemaNode: React.FC<SchemaNodeProps> = ({
  schema,
  selection,
  onToggle,
  path,
  propertyName,
  isRoot = false,
  allSchemas,
  currentSchemaId,
  renderedAncestorIds
}) => {

  // ========================================================================
  // === HOOKS MUST BE CALLED UNCONDITIONALLY AT THE TOP LEVEL =============
  // ========================================================================

  // --- Checkbox State Logic (Derived State - OK before early return) ---
  const isDirectlySelected = selection === true;
  const hasObjectSelection = typeof selection === 'object' && selection !== null;

  // --- $ref Resolution ---
  // Call useMemo unconditionally, but the logic inside depends on schema type
  const { resolvedRefId, resolvedRefSchema, refError } = useMemo(() => {
    // Only perform resolution if schema is an object and has $ref
    if (typeof schema === 'object' && schema !== null && schema.$ref) {
      const id = resolveRefUri(schema.$ref, currentSchemaId);
      const targetSchema = allSchemas[id] || null;
      const error = !targetSchema ? `Referenced schema "${id}" not found in payload.` : null;
      if (error) console.warn(error);
      return { resolvedRefId: id, resolvedRefSchema: targetSchema, refError: error };
    }
    // Return default values if not applicable
    return { resolvedRefId: null, resolvedRefSchema: null, refError: null };
  }, [schema, currentSchemaId, allSchemas]); // Add schema to dependencies

  // --- $ref Target Selection Logic (Derived State - OK before early return) ---
  const hasRefTargetSelection = hasObjectSelection && '$refTargetSelection' in selection;
  const isRefTargetSelected = hasRefTargetSelection;

  // --- Combined Properties Calculation ---
  // Call useMemo unconditionally, but the logic inside depends on schema type
  const propertiesToRender = useMemo(() => {
    // Only calculate if schema is an object and we are not rendering the ref target
    if (typeof schema === 'object' && schema !== null && !hasRefTargetSelection) {
      // Calculate if it's explicitly object, has properties, or uses composition
      if (schema.type === 'object' || schema.properties || schema.allOf || schema.anyOf || schema.oneOf) {
        return getCombinedProperties(schema, currentSchemaId, allSchemas, new Set());
      }
    }
    // Return default value if not applicable
    return {};
  }, [schema, currentSchemaId, allSchemas, hasRefTargetSelection]); // Add schema to dependencies

  // ========================================================================
  // === END OF HOOKS =======================================================
  // ========================================================================


  // --- Handle boolean schemas (Early Return - NOW SAFE) ---
  if (typeof schema === 'boolean') {
    const isSelected = !!selection; // Use simple boolean check for selection
    const handleSimpleToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
      onToggle(path, event.target.checked ? true : undefined);
    };

    return (
      <Box sx={{
        marginLeft: isRoot ? 0 : theme => theme.spacing(2.5),
        paddingLeft: isRoot ? 0 : theme => theme.spacing(1.25),
        borderLeft: isRoot ? 'none' : '1px solid var(--border-color-light)',
        paddingTop: theme => theme.spacing(0.5),
        paddingBottom: theme => theme.spacing(0.5),
     }}
      >
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={isSelected}
              onChange={handleSimpleToggle}
              id={`toggle-${path.join('-')}`}
            />
          }
          label={
            <Typography variant="body2" component="span">
              {propertyName || 'Schema'} (Boolean: {schema.toString()})
            </Typography>
          }
        />
      </Box>
    );
  }

  // --- Main Logic for Object/Array/Ref/Composition Schemas ---
  // Cast is safe now because we returned if it was boolean
  const currentSchema = schema as Schema;

  // --- Callbacks (Define after hooks, before return) ---
  const handleToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = event.target.checked;
    onToggle(path, isChecked ? true : undefined);
  };

  const handleRefTargetToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = event.target.checked;
    const currentSelectionObject = hasObjectSelection ? selection : {};
    let newSelection: SelectionValue | undefined;

    if (isChecked) {
      newSelection = {
        ...currentSelectionObject,
        $refTargetSelection: true,
      };
    } else {
      const { $refTargetSelection, ...rest } = currentSelectionObject;
      newSelection = Object.keys(rest).length > 0 ? rest : undefined;
    }
    onToggle(path, newSelection);
  };

  // --- Derived State / Conditions for Rendering (Define after hooks, before return) ---
  const isCircularOrRepeatedRef = !!resolvedRefId && renderedAncestorIds.has(resolvedRefId);
  const shouldRenderAnyChildren = !!selection;
  const couldBeObject = currentSchema.type === 'object' || currentSchema.properties || currentSchema.allOf || currentSchema.anyOf || currentSchema.oneOf || Object.keys(propertiesToRender).length > 0;
  const couldBeArray = currentSchema.type === 'array' && currentSchema.items;
  const itemsSchema = (couldBeArray && typeof currentSchema.items === 'object' && !Array.isArray(currentSchema.items)) ? currentSchema.items as Schema : null;
  let compositionType = "allOf";
  if (currentSchema.anyOf) compositionType = "anyOf";
  if (currentSchema.oneOf) compositionType = "oneOf";
  

  // --- Label Content ---
  const labelContent = (
    <Box display="flex" alignItems="center">
      <Typography variant="body1" component="span" sx={{ fontWeight: 'bold', mr: 1 }}>
        {propertyName || (currentSchema.title || (isRoot ? 'Root Schema' : 'Schema'))}
      </Typography>
      {!currentSchema.$ref && currentSchema.type && (
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
          ({currentSchema.type})
        </Typography>
      )}
      {!currentSchema.$ref && (currentSchema.allOf || currentSchema.anyOf || currentSchema.oneOf) && (
         <Typography variant="caption" color="text.secondary" sx={{ mr: 1, fontStyle: 'italic' }}>
           (Composition: {compositionType})
         </Typography>
      )}
      {currentSchema.description && (
        <Tooltip title={currentSchema.description} placement="right">
          <IconButton size="small" sx={{ p: 0 }}>
            <InfoOutlinedIcon fontSize="inherit" color="action" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );

  // --- Component Return (for non-boolean schemas) ---
  return (
    <Box sx={{
        marginLeft: isRoot ? 0 : theme => theme.spacing(2.5),
        paddingLeft: isRoot ? 0 : theme => theme.spacing(1.25),
        borderLeft: isRoot ? 'none' : '1px solid var(--border-color-light)',
        paddingTop: theme => theme.spacing(0.5),
        paddingBottom: theme => theme.spacing(0.5),
     }}>
      {/* Main Node Toggle and Info */}
      <Box>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={isDirectlySelected}
              indeterminate={hasObjectSelection}
              onChange={handleToggle}
              id={`toggle-${path.join('-')}`}
            />
          }
          label={labelContent}
          sx={{ mb: (currentSchema.$ref || refError) ? 0 : 1 }}
        />

        {/* Display $ref info */}
        {(currentSchema.$ref || refError) && (
          <Box sx={{ pl: 4, mt: -0.5, mb: 0.5 }}>
            {currentSchema.$ref && (
              <Typography variant="caption" color="info.main">
                $ref: {currentSchema.$ref} {resolvedRefId && `(resolves to: ${resolvedRefId})`}
              </Typography>
            )}
            {refError && (
              <Typography variant="caption" color="error.main">
                Error: {refError}
              </Typography>
            )}
          </Box>
        )}

        {/* $refTargetSelection Toggle */}
        {currentSchema.$ref && shouldRenderAnyChildren && resolvedRefSchema && (
          <Box sx={{ pl: 4, mt: -0.5, mb: 0.5 }}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  id={`toggle-ref-target-${path.join('-')}`}
                  checked={isRefTargetSelected}
                  onChange={handleRefTargetToggle}
                  disabled={isCircularOrRepeatedRef}
                />
              }
              label={
                <Box display="flex" alignItems="center">
                    <Typography variant="body2">Select Target Properties</Typography>
                    {isCircularOrRepeatedRef && (
                        <Typography variant="caption" sx={{ color: 'warning.main', fontStyle: 'italic', ml: 1 }}>
                            (Selection inherited due to cycle/repeat)
                        </Typography>
                    )}
                </Box>
              }
            />
          </Box>
        )}
      </Box>

      {/* --- Render Children --- */}
      {shouldRenderAnyChildren && (
        <Box>
          {/* 1. Render Resolved $ref Content */}
          {hasRefTargetSelection && resolvedRefSchema && resolvedRefId && !isCircularOrRepeatedRef && (
            <Box sx={{
                borderLeft: theme => `2px dotted var(--ref-border-color)`,
                pl: theme => theme.spacing(1.25),
                ml: theme => theme.spacing(-1.5),
                mt: theme => theme.spacing(0.5)
              }}>
              <SchemaNode
                key={`${resolvedRefId}-resolved`}
                schema={resolvedRefSchema}
                currentSchemaId={resolvedRefId}
                selection={getSelectionValue(selection, '$refTargetSelection')}
                path={[...path, '$refTargetSelection']}
                onToggle={onToggle}
                allSchemas={allSchemas}
                propertyName={`(Resolved $ref: ${resolvedRefId})`}
                isRoot={false}
                renderedAncestorIds={new Set([...renderedAncestorIds, currentSchemaId])}
              />
            </Box>
          )}

          {/* 2. Render Object Properties (Combined) */}
          {couldBeObject && !hasRefTargetSelection && Object.keys(propertiesToRender).length > 0 && (
            <Box>
              {Object.entries(propertiesToRender).map(([key, propSchema]) => {
                const childSelectionPath = [...path, 'properties', key];
                const childSelectionValue = getSelectionValue(getSelectionValue(selection, 'properties'), key);

                return (
                  <SchemaNode
                    key={key}
                    schema={propSchema}
                    selection={childSelectionValue}
                    onToggle={onToggle}
                    path={childSelectionPath}
                    propertyName={key}
                    allSchemas={allSchemas}
                    currentSchemaId={currentSchemaId}
                    isRoot={false}
                    renderedAncestorIds={new Set([...renderedAncestorIds, currentSchemaId])}
                  />
                );
              })}
            </Box>
          )}

          {/* 3. Render Array Items */}
          {couldBeArray && !hasRefTargetSelection && itemsSchema && (
            <Box>
              {(() => {
                const itemsSelectionPath = [...path, 'items'];
                const itemsSelectionValue = getSelectionValue(selection, 'items');

                return (
                  <SchemaNode
                    key={`${path.join('-')}-items-node`}
                    schema={itemsSchema}
                    selection={itemsSelectionValue}
                    onToggle={onToggle}
                    path={itemsSelectionPath}
                    propertyName="items"
                    allSchemas={allSchemas}
                    currentSchemaId={currentSchemaId}
                    isRoot={false}
                    renderedAncestorIds={new Set([...renderedAncestorIds, currentSchemaId])}
                  />
                );
              })()}
            </Box>
          )}
           {couldBeArray && !hasRefTargetSelection && !itemsSchema && currentSchema.items !== undefined && (
                 <Typography variant="caption" color="text.secondary" sx={{ ml: 2.5, pl: 1.25, display: 'block' }}>
                    (Array items definition is not a renderable schema object)
                 </Typography>
           )}
        </Box>
      )}
    </Box>
  );
};

export default SchemaNode;
