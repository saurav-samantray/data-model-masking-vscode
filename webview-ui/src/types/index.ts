// src/types/index.ts
import { JSONSchema7, JSONSchema7Definition } from 'json-schema';

// Re-export JSONSchema7 for convenience
export type Schema = JSONSchema7;
export type SchemaDefinition = JSONSchema7Definition;

// Represents the structure of our selection state and the output JSON
export type SelectionValue = boolean | SelectionDetail | undefined;

export interface SelectionDetail {
  // Top-level keywords like title, description
  [key: string]: SelectionValue | PropertiesSelection | ItemsSelection | RefTargetSelection | undefined;
  properties?: PropertiesSelection;
  items?: ItemsSelection; // For arrays
  $refTargetSelection?: SelectionValue; // Specific selection for the target of a $ref
}

export interface PropertiesSelection {
  [key: string]: SelectionValue;
}

export interface ItemsSelection {
  items: SelectionValue;
}

export interface RefTargetSelection {
    $refTargetSelection: SelectionValue;
}

// Type for the state tracking selections
export type SelectionState = SelectionValue;

// --- NEW: Type for the input payload ---
export interface SchemaPayload {
    mainSchemaId: string;
    mainSchemaBasePath: string;
    schemas: {
        [id: string]: Schema; // Map of schema IDs to schema objects
    };
}
