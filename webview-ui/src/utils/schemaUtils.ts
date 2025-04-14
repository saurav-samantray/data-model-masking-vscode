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
 * Handles relative paths like './sibling.json', '../parent/sibling.json', 'sub/child.json',
 * including navigating above the starting ID's directory level (e.g., '../' from a root-level ID).
 * Assumes '/' as the path separator in URIs/IDs.
 *
 * @param ref The $ref string (e.g., "../common/address.json").
 * @param currentId The ID of the schema containing the $ref (e.g., "schemas/main.json" or "Pet.v1.yaml").
 *                  This ID is assumed to be relative to a common base path (like mainSchemaBasePath).
 * @returns The resolved ID string, still relative to the same common base path
 *          (e.g., "schemas/common/address.json" or "../owner/Owner.v1.yaml").
 */
export const resolveRefUri = (ref: string, currentId: string): string => {
    console.log(`schemaUtils.resolveRefUri() Resolving ref '${ref}' relative to '${currentId}'`);
    if (!ref || typeof currentId !== 'string') { // Added type check for currentId
        console.warn(`Cannot resolve ref '${ref}' without a valid string currentId (got: ${currentId})`);
        return ref; // Return original ref as fallback
    }

    // Handle non-relative refs (basic check - assumes they are direct keys)
    // You might need more sophisticated logic if you use absolute URIs or fragments.
    if (!ref.startsWith('.')) {
        console.log(`Treating non-relative ref '${ref}' as a direct key.`);
        return ref;
    }

    // --- Start: Path Normalization Logic ---

    // 1. Get the directory part of the current ID. If no '/', it's the root (represented by '').
    const currentDir = currentId.includes('/') ? currentId.substring(0, currentId.lastIndexOf('/')) : '';

    // 2. Combine the current directory and the reference path.
    // If currentDir is empty, the combined path is just the ref.
    const combinedPath = currentDir ? `${currentDir}/${ref}` : ref;

    // 3. Normalize the combined path (handle '.', '..', and '//').
    const parts = combinedPath.split('/');
    const resolvedParts: string[] = [];

    for (const part of parts) {
        if (part === '' || part === '.') {
            // Skip empty parts (resulting from '//' or trailing '/') or '.' parts.
            continue;
        } else if (part === '..') {
            // If '..', pop the last segment from resolvedParts if possible.
            // If resolvedParts is empty, it means we are trying to go above the starting point.
            // This is valid and the '..' should be kept.
            if (resolvedParts.length > 0 && resolvedParts[resolvedParts.length - 1] !== '..') {
                 // Only pop if the last part isn't already '..' (prevents reducing '../..' to '')
                resolvedParts.pop();
            } else {
                // Cannot go further up relative to the base, or already navigating up. Keep '..'.
                resolvedParts.push('..');
            }
        } else {
            // It's a normal path segment.
            resolvedParts.push(part);
        }
    }

    // 4. Join the resolved parts back together.
    const finalResolvedPath = resolvedParts.join('/');

    // --- End: Path Normalization Logic ---

    console.log(`Resolved path: ${finalResolvedPath}`);
    return finalResolvedPath;
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

