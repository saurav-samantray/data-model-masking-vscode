// src/processor.ts
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode'; // Import vscode for showing messages/using workspace functions
import { Schema as SchemaType, Schema, SelectionValue, RootSelection, SelectionDetail } from './types'; // Import SelectionDetail
import { loadSchemaFile, resolveRefPath, getOutputPath, writeSchemaFile } from './utils';
// import { MASK_SUFFIX } from './extension'; // MASK_SUFFIX now comes from rootSelection

export const PROCESSING_MARKER = { __processing_marker__: true };

// --- Configuration ---
const DEFAULT_OUTPUT_DIR = './output_schemas';
const SELECTION_FILE_SUFFIX = '.config.json'; // Suffix for the selection file
const DEFINITIONS_PATH = 'definitions'; // Or 'components/schemas' for OpenAPI

interface ProcessingCache {
    [originalAbsolutePath: string]: {
        // Stores the result of processing this file's content *in its context*.
        // Might be the processed schema, null, a marker, or potentially a local $ref if processed as a dependency.
        processingResult: SchemaType | null | typeof PROCESSING_MARKER;
    };
}

// New types for definition handling
type DefinitionsAccumulator = { [key: string]: SchemaType };
type DefinitionsBaseNameMap = Map<string, string>; // Map<originalAbsolutePath, definitionKey>

/**
 * Generates a unique and safe key for the definitions object based on a file path.
 */
function generateDefinitionKey(absolutePath: string): string {
    const baseName = path.basename(absolutePath, path.extname(absolutePath));
    // Basic sanitization: replace non-alphanumeric characters with underscores
    const sanitized = baseName.replace(/[^a-zA-Z0-9_]/g, '_');
    // Add a prefix to avoid potential conflicts with schema keywords or starting with a number
    return `ref_${sanitized}`;
}


/**
 * @param originalSchema The schema object to process.
 * @param selection Selection definition for this node.
 * @param originalSchemaPath Absolute path of the FILE this schema fragment originates from.
 * @param baseInputDir Base input directory (used for context, less critical for single file output).
 * @param baseOutputDir Base output directory (used for context, less critical for single file output).
 * @param processedCache Shared cache for file processing results (cycle detection).
 * @param maskSuffix The suffix for the final output file name.
 * @param definitionsAccumulator Object to store schemas that will be embedded in the final output.
 * @param definitionsBaseNameMap Map to track which files have been embedded and their keys.
 * @param isTopLevelCall Internal flag: True if this call represents the entry point for processing originalSchemaPath.
 *                       Set to false for recursive calls on inline properties/items/refs.
 * @returns Processed schema fragment, null, or PROCESSING_MARKER.
 */
export function processSchema(
    originalSchema: SchemaType,
    selection: SelectionValue | undefined,
    originalSchemaPath: string,
    baseInputDir: string, // Keep for context if needed later
    baseOutputDir: string, // Keep for context if needed later
    processedCache: ProcessingCache,
    maskSuffix: string,
    definitionsAccumulator: DefinitionsAccumulator,
    definitionsBaseNameMap: DefinitionsBaseNameMap,
    isTopLevelCall: boolean = true
): SchemaType | null | typeof PROCESSING_MARKER {

    // --- Cache Check & Marker Logic (Only for file-level processing) ---
    // This cache now primarily tracks the processing *state* of a file path for cycle detection.
    if (isTopLevelCall) {
        const cacheEntry = processedCache[originalSchemaPath];
        if (cacheEntry) {
            if (cacheEntry.processingResult === PROCESSING_MARKER) {
                console.log(`Cache hit (cycle detected via $ref): ${originalSchemaPath}`);
                return PROCESSING_MARKER; // Cycle detected
            } else {
                // If already fully processed *as a top-level file*, return its result.
                // Note: If it was processed as a dependency ($ref), this cache entry might
                // just indicate 'done', and the actual result is in definitionsAccumulator.
                // The logic below handles retrieving from definitionsAccumulator via $ref check.
                console.log(`Cache hit (already processed file): ${originalSchemaPath}`);
                return cacheEntry.processingResult;
            }
        }
        // Mark as processing *this file path*
        processedCache[originalSchemaPath] = { processingResult: PROCESSING_MARKER };
        console.log(`Marking file as processing: ${originalSchemaPath}`);
    } else {
        // console.log(`Processing inline part within: ${originalSchemaPath}`);
    }

    // Base case: If selection is explicitly false or undefined, ignore.
    if (!selection) {
        if (isTopLevelCall) {
            // Mark processing as complete (result is null) for this file path
            processedCache[originalSchemaPath] = { processingResult: null };
            console.log(`Finished processing (top-level, no selection): ${originalSchemaPath}`);
        } else {
            // console.log(`Finished processing (inline, no selection) within: ${originalSchemaPath}`);
        }
        return null;
    }

    const outputSchema: SchemaType = {};
    let hasSelectedContent = false;

    // --- Handle $ref (Takes precedence over other structural keywords) ---
    if (originalSchema.$ref && typeof originalSchema.$ref === 'string') {
        const refValue = originalSchema.$ref;

        // --- Handle EXTERNAL $ref ---
        if (!refValue.startsWith('#')) {
            const refAbsolutePath = resolveRefPath(refValue, originalSchemaPath);
            // Determine the selection for the target: Use $refTargetSelection if available, else default to true.
            const refSelection = (selection !== true && selection?.$refTargetSelection) ? selection.$refTargetSelection : true;

            if (!refSelection) {
                console.log(`External $ref "${refValue}" in ${originalSchemaPath} target selection is false. Skipping.`);
                // Fall through to process other keywords if any exist *alongside* the $ref (uncommon but possible)
            } else {
                console.log(`Processing external $ref target: ${refAbsolutePath}`);

                // 1. Check if this referenced file is already embedded or being embedded
                if (definitionsBaseNameMap.has(refAbsolutePath)) {
                    const definitionKey = definitionsBaseNameMap.get(refAbsolutePath)!;
                    console.log(`External $ref target ${refAbsolutePath} already processed/processing. Using definition key: ${definitionKey}`);
                    outputSchema.$ref = `#/${DEFINITIONS_PATH}/${definitionKey}`;
                    hasSelectedContent = true;
                    // IMPORTANT: Do not process other keywords if we resolve the $ref
                    // Update cache for the *current* file if this was the top-level call
                    if (isTopLevelCall) {
                        processedCache[originalSchemaPath] = { processingResult: outputSchema };
                        console.log(`Finished processing (top-level, resolved external $ref): ${originalSchemaPath}`);
                    }
                    return outputSchema; // Return only the $ref
                }

                // 2. Check cache for cycles related to the *target file path*
                const refCacheEntry = processedCache[refAbsolutePath];
                if (refCacheEntry && refCacheEntry.processingResult === PROCESSING_MARKER) {
                    console.warn(`Cycle detected involving $ref target ${refAbsolutePath}. Cannot embed.`);
                     // Decide how to handle: return null, or maybe a placeholder? Null is safer.
                    if (isTopLevelCall) {
                        // Mark the *current* file as failed due to cycle in dependency
                        processedCache[originalSchemaPath] = { processingResult: null };
                        console.log(`Finished processing (top-level, failed due to ref cycle): ${originalSchemaPath}`);
                    }
                    return null;
                }

                // 3. Process the referenced schema's content
                try {
                    const referencedSchema = loadSchemaFile(refAbsolutePath);
                    // Generate a key *before* recursive call to handle self-references within the target file
                    const definitionKey = generateDefinitionKey(refAbsolutePath);
                    definitionsBaseNameMap.set(refAbsolutePath, definitionKey); // Mark as planned for embedding

                    console.log(`Recursively processing content of ${refAbsolutePath} to embed as ${definitionKey}`);
                    // Call processSchema for the *content* of the referenced file.
                    // Treat this as an *internal* part of the current process (isTopLevelCall = false)
                    // Pass down the accumulators.
                    const processedRefSchemaResult = processSchema(
                        referencedSchema,
                        refSelection, // Pass the determined selection for the target
                        refAbsolutePath, // The path context is the referenced file
                        baseInputDir,
                        baseOutputDir,
                        processedCache, // Share cache for cycle detection across files
                        maskSuffix,
                        definitionsAccumulator, // Pass down accumulator
                        definitionsBaseNameMap, // Pass down map
                        true // *** CRITICAL: Treat processing the *referenced file's content* as a top-level call for *that file's cache entry* ***
                    );

                    // 4. Add to definitions if successful
                    if (processedRefSchemaResult && processedRefSchemaResult !== PROCESSING_MARKER && Object.keys(processedRefSchemaResult).length > 0) {
                        console.log(`Successfully processed ref target ${refAbsolutePath}. Adding to definitions as ${definitionKey}.`);
                        definitionsAccumulator[definitionKey] = processedRefSchemaResult;
                        outputSchema.$ref = `#/${DEFINITIONS_PATH}/${definitionKey}`;
                        hasSelectedContent = true;
                    } else {
                        console.log(`Processing ref target ${refAbsolutePath} resulted in no content or cycle marker. Not embedding.`);
                        // Remove the planned key if embedding failed
                        definitionsBaseNameMap.delete(refAbsolutePath);
                        // Fall through to process other keywords if any
                    }
                } catch (error: any) {
                    console.error(`Error processing external $ref "${refValue}" target ${refAbsolutePath}: ${error.message}`);
                    definitionsBaseNameMap.delete(refAbsolutePath); // Remove planned key on error
                    // Fall through to process other keywords if any
                }

                // If we successfully created a local $ref, return *only* that.
                if (outputSchema.$ref && outputSchema.$ref.startsWith(`#/${DEFINITIONS_PATH}/`)) {
                     if (isTopLevelCall) {
                        processedCache[originalSchemaPath] = { processingResult: outputSchema };
                        console.log(`Finished processing (top-level, resolved external $ref): ${originalSchemaPath}`);
                    }
                    return outputSchema;
                }
            }
        }
        // --- Handle INTERNAL $ref ---
        else if (refValue.startsWith('#')) {
            // Keep internal references as they are. We assume the selection process
            // will include the target definition if needed, or the reference will
            // dangle (which is a schema design issue).
            // We could add validation later to check if internal refs point to selected parts.
            console.log(`Keeping internal $ref: ${refValue}`);
            outputSchema.$ref = refValue;
            hasSelectedContent = true; // Assume the ref itself is selected content
            // Don't process other keywords if $ref exists
            if (isTopLevelCall) {
                processedCache[originalSchemaPath] = { processingResult: outputSchema };
                console.log(`Finished processing (top-level, kept internal $ref): ${originalSchemaPath}`);
            }
            return outputSchema;
        }
    } // End $ref handling

    // --- Copy basic keywords (only if no $ref was handled) ---
    // Exclude keywords that will be handled structurally or are part of $ref resolution
    const handledKeywords = new Set(['properties', 'items', '$ref', 'required', DEFINITIONS_PATH, 'allOf', 'anyOf', 'oneOf', 'not']);
    for (const key in originalSchema) {
        if (!handledKeywords.has(key) && originalSchema.hasOwnProperty(key)) {
            // Basic copy
            outputSchema[key] = originalSchema[key];
        }
    }
    if (selection === true && Object.keys(outputSchema).length > 0) {
        hasSelectedContent = true;
    }


    // --- Handle structural keywords ONLY IF no $ref took precedence ---

    // --- Handle properties (Objects) ---
    if (originalSchema.properties && (selection === true || selection?.properties)) {
        const outputProperties: { [key: string]: SchemaType } = {};
        const outputRequired: string[] = [];
        let hasSelectedProperties = false;

        for (const propKey in originalSchema.properties) {
            if (originalSchema.properties.hasOwnProperty(propKey)) {
                const propSelection = selection === true ? true : selection.properties?.[propKey];

                if (propSelection) {
                    const propSchema = originalSchema.properties[propKey];
                    const processedPropSchemaResult = processSchema(
                        propSchema,
                        propSelection,
                        originalSchemaPath, // Still originates from the same file context for resolving nested refs
                        baseInputDir,
                        baseOutputDir,
                        processedCache,
                        maskSuffix,
                        definitionsAccumulator, // Pass down
                        definitionsBaseNameMap, // Pass down
                        false // Not a top-level call for the file
                    );

                    if (processedPropSchemaResult && processedPropSchemaResult !== PROCESSING_MARKER) {
                        outputProperties[propKey] = processedPropSchemaResult;
                        hasSelectedProperties = true;
                        if (originalSchema.required?.includes(propKey)) {
                            outputRequired.push(propKey);
                        }
                    } else if (processedPropSchemaResult === PROCESSING_MARKER) {
                        console.error(`DEV ERROR: PROCESSING_MARKER unexpectedly returned for property '${propKey}' in ${originalSchemaPath}. Check for nested $ref cycles.`);
                    }
                }
            }
        }

        if (hasSelectedProperties) {
            if (!outputSchema.type && originalSchema.type === 'object') outputSchema.type = 'object';
            outputSchema.properties = outputProperties;
            if (outputRequired.length > 0) {
                outputSchema.required = outputRequired;
            }
            hasSelectedContent = true;
        } else if (outputSchema.type === 'object' && Object.keys(outputSchema).length === 1) {
            // Clean up 'type: object' if no properties were selected but type was copied earlier
            delete outputSchema.type;
        }
    } // End properties handling

    // --- Handle items (Arrays) ---
    if (originalSchema.items && typeof originalSchema.items === 'object' && !Array.isArray(originalSchema.items) && (selection === true || selection?.items)) {
        const itemsSelection = selection === true ? true : selection.items;

        if (itemsSelection) {
            const processedItemsSchemaResult = processSchema(
                originalSchema.items as SchemaType,
                itemsSelection,
                originalSchemaPath,
                baseInputDir,
                baseOutputDir,
                processedCache,
                maskSuffix,
                definitionsAccumulator, // Pass down
                definitionsBaseNameMap, // Pass down
                false // Not a top-level call
            );

            if (processedItemsSchemaResult && processedItemsSchemaResult !== PROCESSING_MARKER) {
                if (!outputSchema.type && originalSchema.type === 'array') outputSchema.type = 'array';
                outputSchema.items = processedItemsSchemaResult;
                hasSelectedContent = true;
            } else if (processedItemsSchemaResult === PROCESSING_MARKER) {
                console.error(`DEV ERROR: PROCESSING_MARKER unexpectedly returned for items in ${originalSchemaPath}. Check for nested $ref cycles.`);
            } else if (outputSchema.type === 'array' && Object.keys(outputSchema).length === 1) {
                 // Clean up 'type: array' if no items resulted but type was copied earlier
                delete outputSchema.type;
            }
        }
    } // End items handling

    // --- Handle Composition Keywords (allOf, anyOf, oneOf) ---
    const processComposition = (keyword: 'allOf' | 'anyOf' | 'oneOf') => {
        if (Array.isArray(originalSchema[keyword])) {
            const outputCompositionList: SchemaType[] = [];
            let hasSelectedCompositionItems = false;

            for (const subSchema of originalSchema[keyword]) {
                if (typeof subSchema === 'object' && subSchema !== null) {
                    // Pass the *parent's* selection object down.
                    const processedSubSchemaResult = processSchema(
                        subSchema,
                        selection, // Use the parent's selection object
                        originalSchemaPath,
                        baseInputDir,
                        baseOutputDir,
                        processedCache,
                        maskSuffix,
                        definitionsAccumulator, // Pass down
                        definitionsBaseNameMap, // Pass down
                        false // Not a top-level call
                    );

                    if (processedSubSchemaResult && processedSubSchemaResult !== PROCESSING_MARKER) {
                        outputCompositionList.push(processedSubSchemaResult);
                        hasSelectedCompositionItems = true;
                    } else if (processedSubSchemaResult === PROCESSING_MARKER) {
                        console.error(`DEV ERROR: PROCESSING_MARKER unexpectedly returned for subschema within ${keyword} in ${originalSchemaPath}.`);
                    }
                } else {
                     console.warn(`Skipping non-object item in ${keyword} array within ${originalSchemaPath}`);
                }
            }

            if (hasSelectedCompositionItems) {
                outputSchema[keyword] = outputCompositionList;
                hasSelectedContent = true;
            }
        }
    };

    processComposition('allOf');
    processComposition('anyOf');
    processComposition('oneOf');
    // --- End Composition Handling ---


    // --- Final Step: Update cache (only if top-level) and return ---
    const finalResult = hasSelectedContent ? outputSchema : null;

    if (isTopLevelCall) {
        // Store the final processed result for *this file path* in the cache
        processedCache[originalSchemaPath] = { processingResult: finalResult };
        console.log(`Finished processing (top-level): ${originalSchemaPath} -> ${finalResult ? 'Schema generated' : 'Result is null'}`);
    } else {
        // console.log(`Finished processing (inline): ${originalSchemaPath} -> ${finalResult ? 'Schema generated' : 'Result is null'}`);
    }

    return finalResult;
}


/**
 * Generates a single masked schema file with embedded definitions and a selection file.
 * @param selectionJsonString The selection definition as a JSON string.
 * @param originalContextFilePath The absolute path of the schema file the user was viewing.
 */
export async function generateMask(selectionJsonString: string, originalContextFilePath: string): Promise<void> {
    console.log(`generateMask called with context: ${originalContextFilePath}`);
    console.log(`Received selection JSON string length: ${selectionJsonString.length}`);

    // 1. Parse Selection Definition
    let rootSelection: RootSelection;
    let maskSuffix: string;
    try {
        rootSelection = JSON.parse(selectionJsonString);
        // Basic validation (keep as before)
        if (!rootSelection.mainSchemaId || typeof rootSelection.mainSchemaId !== 'string') {
            throw new Error("Parsed selection must contain a 'mainSchemaId' (string).");
        }
        if (!rootSelection.selection) {
             throw new Error("Parsed selection must contain a 'selection' property (boolean true or object).");
        }
        if (!rootSelection.maskSuffix || typeof rootSelection.maskSuffix !== 'string' || rootSelection.maskSuffix.trim().length === 0) {
            // Use a default suffix if not provided? Or enforce it? Let's enforce for clarity.
            throw new Error("Parsed selection must contain a non-empty 'maskSuffix' (string).");
        }
        maskSuffix = rootSelection.maskSuffix.trim();
        console.log("Successfully parsed selection JSON.");
    } catch (error: any) {
        console.error(`Error parsing selection JSON string: ${error.message}`);
        throw new Error(`Invalid selection format: ${error.message}`);
    }

    // 2. Determine Paths (mostly context, output path determined later)
    const originalContextDir = path.dirname(originalContextFilePath);
    const mainSchemaOriginalPath = path.resolve(originalContextDir, rootSelection.mainSchemaId);
    const baseInputDir = path.dirname(mainSchemaOriginalPath); // Base for resolving relative paths *within* original schemas

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : undefined;
    let baseOutputDir: string;
    const outputDirName = rootSelection.outputDir || DEFAULT_OUTPUT_DIR;

    if (path.isAbsolute(outputDirName)) {
        baseOutputDir = outputDirName;
    } else if (workspaceRoot) {
        baseOutputDir = path.resolve(workspaceRoot, outputDirName);
    } else {
        baseOutputDir = path.resolve(baseInputDir, outputDirName); // Fallback to relative to input
    }
    console.log(`Using effective base output directory: ${baseOutputDir}`);


    // 3. Initialize Cache and Definition Accumulators
    const processedCache: ProcessingCache = {};
    const definitionsAccumulator: DefinitionsAccumulator = {};
    const definitionsBaseNameMap: DefinitionsBaseNameMap = new Map();

    // 4. Load and Process Main Schema
    let mainProcessedSchema: Schema | null | typeof PROCESSING_MARKER = null;
    try {
        if (!fs.existsSync(mainSchemaOriginalPath)) {
            throw new Error(`Main schema file specified in selection ('${rootSelection.mainSchemaId}') not found at resolved path: ${mainSchemaOriginalPath}`);
        }
        const mainSchema = loadSchemaFile(mainSchemaOriginalPath);
        console.log(`Processing main schema: ${mainSchemaOriginalPath}`);
        mainProcessedSchema = processSchema(
            mainSchema,
            rootSelection.selection,
            mainSchemaOriginalPath,
            baseInputDir,
            baseOutputDir, // Pass for context, though less critical now
            processedCache,
            maskSuffix, // Pass validated suffix
            definitionsAccumulator,
            definitionsBaseNameMap,
            true // This is the top-level call
        );
    } catch (error: any) {
        console.error(`Failed to load or process main schema: ${error.message}`);
        if (error.stack) console.error(error.stack);
        throw new Error(`Failed to process schema '${mainSchemaOriginalPath}': ${error.message}`);
    }

    // 5. Construct the Final Single Schema and Prepare for Writing
    let finalCombinedSchema: Schema | null = null;
    let selectionFileName: string | undefined = undefined;
    let selectionFileAbsPath: string | undefined = undefined;
    let outputMaskFilePath: string | undefined = undefined;

    if (mainProcessedSchema && mainProcessedSchema !== PROCESSING_MARKER) {
        // Start with the processed main schema structure
        finalCombinedSchema = { ...mainProcessedSchema }; // Shallow copy

        // Add definitions if any were accumulated
        if (Object.keys(definitionsAccumulator).length > 0) {
            finalCombinedSchema[DEFINITIONS_PATH] = definitionsAccumulator;
            console.log(`Added ${Object.keys(definitionsAccumulator).length} definitions to the final schema.`);
        } else {
            console.log("No external references were selected or embedded.");
        }

        // Determine output file path and selection file path/name
        try {
            // Use getOutputPath just to figure out the relative structure for the *main* file
            const mainOutputRelativePath = path.relative(baseInputDir, mainSchemaOriginalPath);
            const tentativeOutputAbsPath = path.join(baseOutputDir, mainOutputRelativePath);

            const outputDir = path.dirname(tentativeOutputAbsPath);
            const originalExt = rootSelection.maskExtension || path.extname(mainSchemaOriginalPath); // Use override or original ext
            const originalBaseName = rootSelection.maskFileNameBase || path.basename(mainSchemaOriginalPath, path.extname(mainSchemaOriginalPath)); // Use override or original base

            const maskedBaseName = `${originalBaseName}${maskSuffix}`;
            const maskedFileName = `${maskedBaseName}${originalExt}`;
            outputMaskFilePath = path.join(outputDir, maskedFileName); // Final single output file path

            selectionFileName = `${maskedBaseName}${SELECTION_FILE_SUFFIX}`;
            selectionFileAbsPath = path.join(outputDir, selectionFileName);

            // Add x-mask-selection property to the final schema object
            finalCombinedSchema['x-mask-selection'] = selectionFileName;
            console.log(`Added 'x-mask-selection: ${selectionFileName}' to the final combined schema.`);

            // Ensure output directory exists
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

        } catch (error: any) {
            console.error(`Error determining output paths or adding x-mask-selection: ${error.message}`);
            vscode.window.showErrorMessage(`Error preparing output files: ${error.message}`);
            finalCombinedSchema = null; // Prevent writing if setup failed
        }

    } else if (mainProcessedSchema === PROCESSING_MARKER) {
         console.error("Main schema processing resulted in a cycle marker. Cannot generate output.");
         vscode.window.showErrorMessage("Mask generation failed due to a circular reference starting from the main schema.");
    } else {
        console.warn("Main schema processing resulted in an empty schema. No output file will be generated.");
    }


    // 6. Write Output File(s) (Single Schema + Config)
    let fileWritten = false;
    if (finalCombinedSchema && outputMaskFilePath && selectionFileAbsPath && selectionFileName) {
        try {
            // Write the single combined schema file
            // writeSchemaFile handles stringification and uses the correct suffix/base/ext now
            writeSchemaFile(
                outputMaskFilePath, // Pass the full path including the desired filename
                finalCombinedSchema,
                undefined, // Base name is already incorporated into outputMaskFilePath
                '', // Suffix is already incorporated into outputMaskFilePath
                undefined // Extension is already incorporated into outputMaskFilePath
                // NOTE: We could refactor writeSchemaFile to just take the final path directly
                // For now, passing empty suffix/ext ensures it doesn't modify the path further.
                // Let's adjust writeSchemaFile slightly to handle this better.
                // *** See adjustment suggestion for writeSchemaFile below ***

                // --- Alternative using adjusted writeSchemaFile ---
                // Assuming writeSchemaFile is adjusted to prioritize a full provided path
                // writeSchemaFile(outputMaskFilePath, finalCombinedSchema);
            );
            fileWritten = true;
            const relativeMaskPath = path.relative(workspaceRoot || baseInputDir, outputMaskFilePath);
            console.log(`Successfully wrote combined masked schema to: ${outputMaskFilePath}`);


            // Write the selection config file
            const fullRootSelectionForFile: RootSelection = {
                ...rootSelection,
                outputDir: path.relative(workspaceRoot || baseInputDir, baseOutputDir) // Store relative output path used
            };
            console.log(`Writing selection details to: ${selectionFileAbsPath}`);
            fs.writeFileSync(selectionFileAbsPath, JSON.stringify(fullRootSelectionForFile, null, 2), 'utf-8');

            // Final User Feedback
            let message = `Successfully generated masked schema '${relativeMaskPath}'.`;
            message += ` Selection details saved to '${selectionFileName}'.`;
            console.log(message);
            vscode.window.showInformationMessage(message);

        } catch (error: any) {
            console.error(`Failed during file writing: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to write output file(s): ${error.message}`);
            fileWritten = false; // Ensure correct final message
        }
    }

    // 7. Final Feedback if no file was written
    if (!fileWritten && mainProcessedSchema !== PROCESSING_MARKER) { // Avoid double message if marker error already shown
        console.log(`\nSchema processing complete. No non-empty schema was generated to write.`);
        vscode.window.showWarningMessage("Mask generation finished, but no schema content was selected or an error occurred during output preparation.");
    }
}

