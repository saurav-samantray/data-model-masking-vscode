import React from 'react';
import { Schema, SchemaDefinition, SelectionValue } from '../types';
import { resolveRefUri, getSelectionValue } from '../utils/schemaUtils';

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
  allSchemas: { [id: string]: Schema };
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
  // Handle boolean schemas (treat as simple selection)
  if (typeof schema === 'boolean') {
    const isSelected = !!selection;
    const handleSimpleToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
      onToggle(path, event.target.checked);
    };

    return (
      <Box sx={{ ml: isRoot ? 0 : 2.5, pl: isRoot ? 0 : 1.25, borderLeft: isRoot ? 'none' : '1px solid #eee' }}>
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

  // --- Main Logic for Object/Array/Ref Schemas ---
  const currentSchema = schema as Schema; // Cast since we handled boolean case
  //const isSelected = !!selection && typeof selection !== 'object'; // Simple true selection

  // --- MODIFIED Checkbox State Logic ---
  const isDirectlySelected = selection === true; // Is the node itself selected with 'true'?
  const hasObjectSelection = typeof selection === 'object' && selection !== null; // Is the selection an object (meaning children/ref target are selected)?

  const handleToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = event.target.checked;
    // If unchecking, remove the entire selection object or set to false
    // If checking, set to true (further refinement happens via $refTargetSelection etc.)
    onToggle(path, isChecked ? true : undefined);
  };

  const handleRefTargetToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = event.target.checked;
    const currentSelectionObject = typeof selection === 'object' ? selection : {};
    const newSelection = {
      ...currentSelectionObject,
      $refTargetSelection: isChecked ? {} : undefined, // Initialize as empty object or remove
    };
    // Ensure we don't leave an empty object if $refTargetSelection is the only key
    if (!isChecked && Object.keys(newSelection).length === 1 && newSelection.$refTargetSelection === undefined) {
        onToggle(path, true); // Revert to simple 'true' if unchecking target and nothing else selected
    } else {
        onToggle(path, newSelection);
    }
  };

  const hasRefTargetSelection = typeof selection === 'object' && selection !== null && '$refTargetSelection' in selection;
  const isRefTargetSelected = hasRefTargetSelection; // Checkbox reflects if the $refTargetSelection key exists

  // Resolve $ref
  let resolvedRefSchema: Schema | null = null;
  let resolvedRefId: string | null = null;
  let refError: string | null = null;

  if (currentSchema.$ref) {
      resolvedRefId = resolveRefUri(currentSchema.$ref, currentSchemaId);
      resolvedRefSchema = allSchemas[resolvedRefId] || null;
      if (!resolvedRefSchema) {
          refError = `Referenced schema "${resolvedRefId}" not found in payload.`;
          console.warn(refError);
      }
  }

  const isCircularOrRepeatedRef = !!resolvedRefId && renderedAncestorIds.has(resolvedRefId);

  // Determine if children should be rendered based on type and $ref selection
  const shouldRenderObjectChildren = currentSchema.type === 'object' && currentSchema.properties;
  const shouldRenderArrayChildren = currentSchema.type === 'array' && currentSchema.items && typeof currentSchema.items === 'object';

  // --- MODIFIED Condition for rendering children ---
  // Render children if there is *any* selection for this node (true or object)
  const shouldRenderAnyChildren = !!selection;

  const labelContent = (
    <Box display="flex" alignItems="center">
      <Typography variant="body1" component="span" sx={{ fontWeight: 'bold', mr: 1 }}>
        {propertyName || (currentSchema.title || 'Root')}
      </Typography>
      {currentSchema.type && (
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
          ({currentSchema.type})
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

  return (
    <Box sx={{
        marginLeft: isRoot ? 0 : theme => theme.spacing(2.5),
        paddingLeft: isRoot ? 0 : theme => theme.spacing(1.25),
        borderLeft: isRoot ? 'none' : '1px solid #eee',
        paddingTop: theme => theme.spacing(0.5),
        paddingBottom: theme => theme.spacing(0.5),
     }}>
      {/* Main Node Toggle and Info */}
      <Box>
      <FormControlLabel
          control={
            <Checkbox
              size="small"
              // --- MODIFIED Checkbox State ---
              checked={isDirectlySelected} // Checked only if selection is exactly 'true'
              indeterminate={hasObjectSelection} // Indeterminate if selection is an object
              onChange={handleToggle}
              id={`toggle-${path.join('-')}`}
            />
          }
          label={labelContent}
          sx={{ mb: (currentSchema.$ref || refError) ? 0 : 1 }}
        />

        {/* Display $ref info */}
        {(currentSchema.$ref || refError) && (
          <Box sx={{ pl: 4, mt: -0.5, mb: 0.5 }}> {/* Indent under the checkbox */}
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

        {/* $refTargetSelection Toggle (only if $ref exists and is resolved and parent is selected) */}
        {currentSchema.$ref && shouldRenderAnyChildren && resolvedRefSchema && (
          <Box sx={{ pl: 4, mt: -0.5, mb: 0.5 }}> {/* Indent under the checkbox */}
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
      {/* --- Use shouldRenderAnyChildren --- */}
      {shouldRenderAnyChildren && (
      <Box>
        {/* 1. Render Resolved $ref Content */}
        {hasRefTargetSelection && resolvedRefSchema && resolvedRefId && !isCircularOrRepeatedRef && (
          <Box sx={{
              borderLeft: theme => `2px dotted ${theme.palette.info.light}`,
              pl: theme => theme.spacing(1.25),
              ml: theme => theme.spacing(-1.5), // Adjust for visual alignment with parent checkbox
              mt: theme => theme.spacing(0.5)
            }}>
            <SchemaNode
              // --- ADD KEY for resolved ref ---
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

        {/* 2. Render Object Properties */}
        {shouldRenderObjectChildren && !hasRefTargetSelection && currentSchema.properties && (
          <Box>
            {Object.entries(currentSchema.properties).map(([key, propSchema]) => {
              const childSelectionPath = [...path, 'properties', key];
              const childSelectionValue = getSelectionValue(getSelectionValue(selection, 'properties'), key);

              return (
                <SchemaNode
                  key={key} // Key is already stable here based on property name
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

        {/* 3. Render Array Items (only if selected and not rendering resolved ref content OR if no ref exists) */}
        {shouldRenderArrayChildren && !hasRefTargetSelection && currentSchema.items && (
          <Box>
            {(() => {
              const itemsSelectionPath = [...path, 'items'];
              const itemsSelectionValue = getSelectionValue(selection, 'items');
              const itemsSchema = (typeof currentSchema.items === 'object' && !Array.isArray(currentSchema.items)) ? currentSchema.items as Schema : null;

              return itemsSchema ? (
                <SchemaNode
                  // --- ADD KEY for items node ---
                  key={`${path.join('-')}-items-node`} // Use path to ensure uniqueness if multiple arrays exist
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
              ) : (
                // Handle case where items is not a schema object (e.g., boolean) or is missing
                 <Typography variant="caption" color="text.secondary" sx={{ ml: 2.5, pl: 1.25 }}>
                    (Array items definition is not a schema object)
                 </Typography>
              );
            })()}
          </Box>
        )}
      </Box>
      )}
    </Box>
  );
};

export default SchemaNode;
