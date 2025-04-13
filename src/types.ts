import { JSONSchema7 } from 'json-schema';

// Using JSONSchema7 for better type safety, but allow 'any' for flexibility
export type Schema = JSONSchema7 | any;

// Represents the selection detail for a specific schema node (property, items, or root)
// This replaces the old SelectionNode and avoids the index signature conflict.
export interface SelectionDetail {
    // Selection for nested properties (if the node is an object)
    // Key is the property name, value indicates selection (true or further detail)
    properties?: { [key: string]: SelectionValue };

    // Selection for array items (if the node is an array)
    // Value indicates selection (true or further detail)
    items?: SelectionValue;

    // Selection for the target of a $ref (if the node has a $ref)
    // Value indicates selection (true or further detail)
    $refTargetSelection?: SelectionValue;

    // Explicitly allow selecting common top-level keywords? Add more as needed.
    title?: true;
    description?: true;
    // Add other keywords like 'type', 'format', 'enum' if you want to select them explicitly
}

// Defines the possible values for a selection: either select fully (true) or provide nested details
export type SelectionValue = true | SelectionDetail;

// Represents the overall selection input structure
export interface RootSelection {
  // The entry point schema ID (relative path from project root or script location)
  mainSchemaId: string;

  mainSchemaBasePath: string;

  // The selection definition starting from the main schema.
  // The root selection itself must be a detailed object.
  selection: SelectionDetail;

  // Optional: Specify the output directory
  outputDir?: string;
}

// Internal cache for processed schemas to avoid redundant work and handle circular refs (basic)
export interface ProcessedSchemaCache {
  [originalAbsolutePath: string]: {
    outputRelativePath: string;
    outputSchema: Schema;
  };
}


export interface SchemaPayload {
  mainSchemaId: string;
  mainSchemaBasePath: string;
  schemas: {
      [id: string]: Schema; // Map of schema IDs to schema objects
  };
}

export type SchemaMap = {
  [id: string]: Schema;
};
