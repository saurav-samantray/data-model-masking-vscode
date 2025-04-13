// src/utils/schemaUtils.ts

import { SelectionValue, Schema, SchemaPayload } from '../types'; // Adjust path if your types file is elsewhere

/**
 * Safely retrieves a nested value from a potentially complex SelectionValue object.
 * Handles cases where the selection is true, false, null, undefined, or an object.
 *
 * @param selection The current level of the selection state (can be boolean, object, or undefined).
 * @param key The property key (string or number) to access within the selection object.
 * @returns The nested SelectionValue or undefined if not found or not applicable.
 */
export const getSelectionValue = (selection: SelectionValue | undefined, key: string | number): SelectionValue | undefined => {
    // If selection is not an object or is null, we cannot access a sub-property by key.
    if (typeof selection !== 'object' || selection === null) {
        return undefined;
    }
    // We assume 'selection' is a SelectionDetail-like object here.
    // Using 'any' for simplicity, but could be refined with more specific type guards if needed.
    return (selection as any)[key];
};


/**
 * Resolves a relative $ref URI based on the ID of the current schema.
 * Handles basic relative paths like './sibling.json', '../parent/sibling.json', 'sub/child.json'.
 * Assumes '/' as the path separator in URIs/IDs.
 *
 * NOTE: This is a simplified implementation for demonstration. Robust URI resolution
 * can be more complex, especially with absolute paths, fragments (#), etc.
 *
 * @param ref The $ref string (e.g., "./common/address.json").
 * @param currentId The ID of the schema containing the $ref (e.g., "schemas/main.json").
 * @returns The resolved ID string (e.g., "schemas/common/address.json").
 */
export const resolveRefUri = (ref: string, currentId: string): string => {
    if (!ref || !currentId) {
        // Cannot resolve without context, return the original ref or handle as error
        console.warn(`Cannot resolve ref '${ref}' without a valid currentId '${currentId}'`);
        return ref;
    }

    // If ref looks like an absolute path (or at least not starting with '.'),
    // assume it's resolvable directly as a key in the schemas map,
    // or handle based on a known base URI if applicable.
    // This basic check assumes IDs like "schemas/common/address.json" are used directly.
    if (!ref.startsWith('.')) {
        // A more robust solution might involve URL parsing if IDs were full URLs.
        // For simple path-like IDs, we might need more context about the 'root'.
        // Let's assume for now that non-relative refs are used as direct keys.
        // Example: If ref is "definitions/address" and currentId is "schemas/main",
        // we might just return "definitions/address".
        // A refinement could be to check if currentId has a known prefix and apply it.
         const commonPrefixes = ['schemas/', 'definitions/', 'models/']; // Example prefixes
         if (commonPrefixes.some(prefix => currentId.startsWith(prefix) && !ref.startsWith(prefix))) {
             // If currentId has a prefix but ref doesn't, assume ref is relative to root of that prefix
             const prefix = commonPrefixes.find(p => currentId.startsWith(p));
             if (prefix) return prefix + ref;
         }
         // Otherwise, return the ref as is, assuming it's a direct key
        return ref;
    }

    // Handle relative paths (./ and ../)
    const currentParts = currentId.split('/');
    const refParts = ref.split('/');

    // Remove the filename part from the current path to get the base directory
    currentParts.pop();

    for (const part of refParts) {
        if (part === '' || part === '.') {
            // Ignore empty parts (e.g., from '//') or current directory references '.'
            continue;
        } else if (part === '..') {
            // Go up one level, but don't go above the conceptual root
            if (currentParts.length > 0) {
                currentParts.pop();
            } else {
                // Trying to go above root - log a warning
                console.warn(`Cannot resolve '../' beyond the root from ref '${ref}' relative to '${currentId}'`);
                // Behavior here could vary: stop, return error indicator, or stay at root.
                // Staying at root (by doing nothing more with currentParts) is one option.
            }
        } else {
            // Go into a subdirectory or add the filename part
            currentParts.push(part);
        }
    }

    return currentParts.join('/');
};

// --- setDeepValue (Moved from App.tsx and Exported) ---
export const setDeepValue = (obj: any, path: (string | number)[], value: SelectionValue): any => {
    if (path.length === 0) {
        return value;
    }

    const currentKey = path[0];
    const remainingPath = path.slice(1);

    let currentLevel = (typeof obj === 'object' && obj !== null && !Array.isArray(obj))
                       ? { ...obj }
                       : {};

    const currentValueForKey = currentLevel[currentKey];
    const newValueForKey = setDeepValue(currentValueForKey, remainingPath, value);

    if (newValueForKey === undefined) {
        delete currentLevel[currentKey];
    } else {
        currentLevel[currentKey] = newValueForKey;
    }

    return Object.keys(currentLevel).length > 0 ? currentLevel : undefined;
};

