// src/processor.ts
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode'; // Import vscode for showing messages/using workspace functions
import { Schema as SchemaType, Schema, SelectionValue, RootSelection, SelectionDetail } from './types'; // Import SelectionDetail
import { loadSchemaFile, resolveRefPath, getOutputPath, writeSchemaFile } from './utils';
import { MASK_SUFFIX } from './extension';

export const PROCESSING_MARKER = { __processing_marker__: true };

// --- Configuration ---
const DEFAULT_OUTPUT_DIR = './output_schemas';
const SELECTION_FILE_SUFFIX = '.config.json'; // Suffix for the selection file

interface ProcessingCache {
    [originalAbsolutePath: string]: {
        outputSchema: SchemaType | null | typeof PROCESSING_MARKER;
    };
}

/**
 * @param originalSchema The schema object to process.
 * @param selection Selection definition for this node.
 * @param originalSchemaPath Absolute path of the FILE this schema fragment originates from.
 * @param baseInputDir Base input directory.
 * @param baseOutputDir Base output directory.
 * @param processedCache Shared cache for file processing results.
 * @param isTopLevelCall Internal flag: True if this call represents the entry point for processing originalSchemaPath.
 *                       Set to false for recursive calls on inline properties/items.
 * @returns Processed schema, null, or PROCESSING_MARKER (only if a cycle is detected via $ref).
 */
export function processSchema(
    originalSchema: SchemaType,
    selection: SelectionValue | undefined,
    originalSchemaPath: string,
    baseInputDir: string,
    baseOutputDir: string,
    processedCache: ProcessingCache,
    maskSuffix: string, // *** ADD maskSuffix parameter ***
    isTopLevelCall: boolean = true // Default to true for external calls
): SchemaType | null | typeof PROCESSING_MARKER {

    // --- Cache Check & Marker Logic (Only for top-level file calls) ---
    if (isTopLevelCall) {
        const cacheEntry = processedCache[originalSchemaPath];
        if (cacheEntry) {
            if (cacheEntry.outputSchema === PROCESSING_MARKER) {
                console.log(`Cache hit (top-level processing in progress - cycle detected via $ref): ${originalSchemaPath}`);
                return PROCESSING_MARKER;
            } else {
                console.log(`Cache hit (top-level already fully processed): ${originalSchemaPath}`);
                return cacheEntry.outputSchema;
            }
        }
        processedCache[originalSchemaPath] = { outputSchema: PROCESSING_MARKER };
        console.log(`Marking file as processing (top-level): ${originalSchemaPath}`);
    } else {
        console.log(`Processing inline part within: ${originalSchemaPath}`);
    }

    // Base case: If selection is explicitly false or undefined, ignore.
    if (!selection) {
        if (isTopLevelCall) {
            delete processedCache[originalSchemaPath];
            console.log(`Finished processing (top-level, no selection): ${originalSchemaPath}`);
        } else {
            console.log(`Finished processing (inline, no selection) within: ${originalSchemaPath}`);
        }
        return null;
    }

    const outputSchema: SchemaType = {};
    let hasSelectedContent = false;

    // --- Copy basic keywords ---
    // Exclude keywords that will be handled structurally (properties, items, refs, composition)
    const handledKeywords = new Set(['properties', 'items', '$ref', 'required', 'definitions', 'allOf', 'anyOf', 'oneOf', 'not']);
    for (const key in originalSchema) {
        if (!handledKeywords.has(key)) {
            // Ensure we don't copy empty objects/arrays that might be handled later
            if (typeof originalSchema[key] !== 'object' || originalSchema[key] === null || Array.isArray(originalSchema[key]) || Object.keys(originalSchema[key]).length > 0) {
                outputSchema[key] = originalSchema[key];
            }
        }
    }
    // If selection is true, any copied basic keyword means we have content.
    // If selection is an object, we need to wait until structural parts are processed.
    if (selection === true && Object.keys(outputSchema).length > 0) {
        hasSelectedContent = true;
    }

    // --- Handle $ref (Takes precedence over other structural keywords) ---
    if (originalSchema.$ref) {
        const refAbsolutePath = resolveRefPath(originalSchema.$ref, originalSchemaPath);
        // Determine the selection for the target: Use $refTargetSelection if available in detail, otherwise default to true.
        const refSelection = (selection !== true && selection?.$refTargetSelection) ? selection.$refTargetSelection : true;

        let processedRefSchemaResult: SchemaType | null | typeof PROCESSING_MARKER = null;
        let refNeedsProcessing = false;

        if (refSelection) {
            refNeedsProcessing = true;
        } else {
            console.log(`$ref "${originalSchema.$ref}" in ${originalSchemaPath} exists but its target selection resolved to false.`);
        }

        if (refNeedsProcessing) {
            console.log(`Processing $ref target: ${refAbsolutePath}`);
            try {
                const refCacheEntry = processedCache[refAbsolutePath];
                if (refCacheEntry) {
                    processedRefSchemaResult = refCacheEntry.outputSchema; // Use cached result (could be null, schema, or marker)
                    if (processedRefSchemaResult === PROCESSING_MARKER) {
                        console.log(`Ref target ${refAbsolutePath} is currently being processed (cycle detected).`);
                    } else {
                         console.log(`Ref target ${refAbsolutePath} was already processed.`);
                    }
                } else {
                    const referencedSchema = loadSchemaFile(refAbsolutePath);
                    processedRefSchemaResult = processSchema(
                        referencedSchema,
                        refSelection, // Pass the determined selection for the target
                        refAbsolutePath,
                        baseInputDir,
                        baseOutputDir,
                        processedCache,
                        maskSuffix, // Pass suffix down
                        true // This is a top-level call for the referenced file
                    );
                }

            } catch (error: any) {
                console.error(`Error processing $ref "${originalSchema.$ref}" in ${originalSchemaPath}: ${error.message}`);
                processedRefSchemaResult = null;
            }

            // If the ref processing resulted in something (even a marker), create the $ref link in the output
            if (processedRefSchemaResult === PROCESSING_MARKER || (processedRefSchemaResult && Object.keys(processedRefSchemaResult).length > 0)) {
                const currentOutputSchemaPath = getOutputPath(originalSchemaPath, baseInputDir, baseOutputDir);
                const refOutputPath = getOutputPath(refAbsolutePath, baseInputDir, baseOutputDir);

                let refOutputRelativePath = path.relative(path.dirname(currentOutputSchemaPath), refOutputPath);
                refOutputRelativePath = refOutputRelativePath.replace(/\\/g, '/');

                const refDir = path.dirname(refOutputRelativePath);
                const refExt = path.extname(refOutputRelativePath);
                const refBaseName = path.basename(refOutputRelativePath, refExt);
                const maskedRefFileName = `${refBaseName}${maskSuffix}${refExt}`;
                refOutputRelativePath = path.join(refDir, maskedRefFileName).replace(/\\/g, '/');

                if (!refOutputRelativePath.startsWith('.') && !refOutputRelativePath.startsWith('/')) {
                    refOutputRelativePath = './' + refOutputRelativePath;
                }

                // Clear any basic keywords copied earlier and just use the $ref
                Object.keys(outputSchema).forEach(key => delete outputSchema[key]);
                outputSchema.$ref = refOutputRelativePath;
                hasSelectedContent = true; // A valid $ref means content

            } else {
                console.log(`Referenced schema ${refAbsolutePath} resulted in no selected content or error. No $ref added for ${originalSchemaPath}.`);
                // Keep any basic keywords if the ref processing failed/was empty
                if (Object.keys(outputSchema).length > 0) {
                    hasSelectedContent = true;
                }
            }
        } else {
            // Ref target selection was false, keep basic keywords if any
            if (Object.keys(outputSchema).length > 0) {
                hasSelectedContent = true;
            }
        }
    } // End $ref handling

    // --- Handle structural keywords ONLY IF no $ref took precedence ---
    if (!outputSchema.$ref) {

        // --- Handle properties (Objects) ---
        if (originalSchema.properties && (selection === true || selection?.properties)) {
            const outputProperties: { [key: string]: SchemaType } = {};
            const outputRequired: string[] = [];
            let hasSelectedProperties = false;

            for (const propKey in originalSchema.properties) {
                if (originalSchema.properties.hasOwnProperty(propKey)) {
                    // Determine selection: If overall selection is true, prop is selected.
                    // Otherwise, check selection.properties[propKey].
                    const propSelection = selection === true ? true : selection.properties?.[propKey];

                    if (propSelection) {
                        const propSchema = originalSchema.properties[propKey];
                        const processedPropSchemaResult = processSchema(
                            propSchema,
                            propSelection, // Pass the specific selection for this property
                            originalSchemaPath, // Still originates from the same file
                            baseInputDir,
                            baseOutputDir,
                            processedCache,
                            maskSuffix, // Pass suffix down
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
                delete outputSchema.type; // Clean up 'type: object' if no properties were selected
            }
        } // End properties handling

        // --- Handle items (Arrays) ---
        if (originalSchema.items && typeof originalSchema.items === 'object' && !Array.isArray(originalSchema.items) && (selection === true || selection?.items)) {
            const itemsSelection = selection === true ? true : selection.items;

            if (itemsSelection) {
                const processedItemsSchemaResult = processSchema(
                    originalSchema.items as SchemaType,
                    itemsSelection, // Pass the specific selection for items
                    originalSchemaPath,
                    baseInputDir,
                    baseOutputDir,
                    processedCache,
                    maskSuffix, // Pass suffix down
                    false // Not a top-level call
                );

                if (processedItemsSchemaResult && processedItemsSchemaResult !== PROCESSING_MARKER) {
                    if (!outputSchema.type && originalSchema.type === 'array') outputSchema.type = 'array';
                    outputSchema.items = processedItemsSchemaResult;
                    hasSelectedContent = true;
                } else if (processedItemsSchemaResult === PROCESSING_MARKER) {
                    console.error(`DEV ERROR: PROCESSING_MARKER unexpectedly returned for items in ${originalSchemaPath}. Check for nested $ref cycles.`);
                } else if (outputSchema.type === 'array' && Object.keys(outputSchema).length === 1) {
                    delete outputSchema.type; // Clean up 'type: array' if no items resulted
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
                        // IMPORTANT: Pass the *parent's* selection object down.
                        // The properties defined within the subSchema are conceptually
                        // at the parent level and should be checked against selection.properties.
                        const processedSubSchemaResult = processSchema(
                            subSchema,
                            selection, // Use the parent's selection object
                            originalSchemaPath,
                            baseInputDir,
                            baseOutputDir,
                            processedCache,
                            maskSuffix, // Pass suffix down
                            false // Not a top-level call
                        );

                        if (processedSubSchemaResult && processedSubSchemaResult !== PROCESSING_MARKER) {
                            outputCompositionList.push(processedSubSchemaResult);
                            hasSelectedCompositionItems = true;
                        } else if (processedSubSchemaResult === PROCESSING_MARKER) {
                            console.error(`DEV ERROR: PROCESSING_MARKER unexpectedly returned for subschema within ${keyword} in ${originalSchemaPath}.`);
                            // Decide how to handle - maybe add a placeholder? For now, skip.
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

    } // End structural keywords handling (if no $ref)


    // --- Final Step: Update cache (only if top-level) and return ---
    const finalResult = hasSelectedContent ? outputSchema : null;

    if (isTopLevelCall) {
        if (finalResult !== PROCESSING_MARKER) {
            processedCache[originalSchemaPath] = { outputSchema: finalResult };
            console.log(`Finished processing (top-level): ${originalSchemaPath} -> ${finalResult ? 'Schema generated' : 'Result is null'}`);
        } else {
            console.log(`Finished processing (top-level - cycle detected): ${originalSchemaPath} -> Returning marker`);
        }
    } else {
        console.log(`Finished processing (inline): ${originalSchemaPath} -> ${finalResult ? 'Schema generated' : 'Result is null'}`);
    }

    return finalResult;
}


// --- generateMask function remains the same ---
// No changes needed here as it calls processSchema which now handles composition.
/**
 * Generates the masked schema and a selection file based on the selection definition.
 * @param selectionJsonString The selection definition as a JSON string.
 * @param originalContextFilePath The absolute path of the schema file the user was viewing.
 */
export async function generateMask(selectionJsonString: string, originalContextFilePath: string): Promise<void> {
    console.log(`generateMask called with context: ${originalContextFilePath}`);
    console.log(`Received selection JSON string length: ${selectionJsonString.length}`);

    // 1. Parse Selection Definition
    let rootSelection: RootSelection;
    let maskSuffix: string; // Variable to hold the validated suffix
    try {
        rootSelection = JSON.parse(selectionJsonString);
        if (!rootSelection.mainSchemaId || typeof rootSelection.mainSchemaId !== 'string') {
            throw new Error("Parsed selection must contain a 'mainSchemaId' (string).");
        }
        // Allow selection to be 'true' at the root, although UI might enforce object
        if (!rootSelection.selection) {
             throw new Error("Parsed selection must contain a 'selection' property (boolean true or object).");
        }
        // *** ADD: Extract and validate maskSuffix ***
        if (!rootSelection.maskSuffix || typeof rootSelection.maskSuffix !== 'string' || rootSelection.maskSuffix.trim().length === 0) {
            throw new Error("Parsed selection must contain a non-empty 'maskSuffix' (string).");
        }
        maskSuffix = rootSelection.maskSuffix.trim(); // Store the validated suffix
        console.log("Successfully parsed selection JSON.");
    } catch (error: any) {
        console.error(`Error parsing selection JSON string: ${error.message}`);
        throw new Error(`Invalid selection format: ${error.message}`);
    }

    // 2. Determine Paths
    const originalContextDir = path.dirname(originalContextFilePath);
    // Resolve mainSchemaId relative to the *context* file's directory if it's relative
    const mainSchemaOriginalPath = path.resolve(originalContextDir, rootSelection.mainSchemaId);
    const baseInputDir = path.dirname(mainSchemaOriginalPath); // Base for relative paths *within* schemas

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : undefined;
    let baseOutputDir: string;
    // Use outputDir from selection if present, otherwise default
    const outputDirName = rootSelection.outputDir || DEFAULT_OUTPUT_DIR;

    if (path.isAbsolute(outputDirName)) {
        baseOutputDir = outputDirName;
        console.log(`Using absolute output directory: ${baseOutputDir}`);
    } else if (workspaceRoot) {
        baseOutputDir = path.resolve(workspaceRoot, outputDirName);
         console.log(`Using workspace-relative output directory: ${baseOutputDir}`);
    } else {
        console.warn("No workspace folder found and output directory is relative. Output directory will be relative to the input schema's directory.");
        baseOutputDir = path.resolve(baseInputDir, outputDirName);
         console.log(`Using input-relative output directory: ${baseOutputDir}`);
    }


    console.log(`Processing main schema: ${mainSchemaOriginalPath}`);
    console.log(`Using base input directory: ${baseInputDir}`);
    console.log(`Using base output directory: ${baseOutputDir}`);

    // 3. Initialize Cache
    const processedCache: ProcessingCache = {};

    // 4. Load and Process Main Schema
    let mainProcessingResult: Schema | null | typeof PROCESSING_MARKER = null;
    try {
        if (!fs.existsSync(mainSchemaOriginalPath)) {
            throw new Error(`Main schema file specified in selection ('${rootSelection.mainSchemaId}') not found at resolved path: ${mainSchemaOriginalPath}`);
        }
        const mainSchema = loadSchemaFile(mainSchemaOriginalPath);
        mainProcessingResult = processSchema(
            mainSchema,
            rootSelection.selection, // Pass the root selection value
            mainSchemaOriginalPath,
            baseInputDir,
            baseOutputDir,
            processedCache,
            maskSuffix, // Pass suffix down
            true // This is the top-level call
        );
    } catch (error: any) {
        console.error(`Failed to load or process main schema: ${error.message}`);
        if (error.stack) console.error(error.stack);
        throw new Error(`Failed to process schema '${mainSchemaOriginalPath}': ${error.message}`);
    }

    // 5. Prepare for Writing - Determine Selection File Path
    let selectionFileName: string | undefined = undefined;
    let selectionFileAbsPath: string | undefined = undefined;
    let fullRootSelectionForFile: RootSelection | undefined = undefined; // Store the full object

    // Only proceed if the main schema processing was successful
    if (mainProcessingResult && mainProcessingResult !== PROCESSING_MARKER) {
        try {
            const mainOutputAbsPath = getOutputPath(mainSchemaOriginalPath, baseInputDir, baseOutputDir);
            const mainOutputDir = path.dirname(mainOutputAbsPath);
            const mainOriginalBaseName = path.basename(mainSchemaOriginalPath, path.extname(mainSchemaOriginalPath));
            const maskedBaseName = `${mainOriginalBaseName}${maskSuffix}`; // Add suffix to the base name

            selectionFileName = `${maskedBaseName}${SELECTION_FILE_SUFFIX}`;
            selectionFileAbsPath = path.join(mainOutputDir, selectionFileName);

            // Prepare the full object to save (includes outputDir used)
            fullRootSelectionForFile = {
                ...rootSelection,
                outputDir: path.relative(workspaceRoot || baseInputDir, baseOutputDir) // Store relative output path used
            };


            if (!fs.existsSync(mainOutputDir)) {
                fs.mkdirSync(mainOutputDir, { recursive: true });
            }

            // Write the FULL RootSelection object to the config file
            console.log(`Writing full selection details to: ${selectionFileAbsPath}`);
            fs.writeFileSync(selectionFileAbsPath, JSON.stringify(fullRootSelectionForFile, null, 2), 'utf-8'); // Save the whole object

        } catch (error: any) {
            console.error(`Failed to write selection file ${selectionFileAbsPath || 'unknown path'}: ${error.message}`);
            vscode.window.showWarningMessage(`Failed to write selection file: ${error.message}. Schema files might still be generated.`);
            selectionFileName = undefined; // Ensure we don't add the x-extension if saving failed
            fullRootSelectionForFile = undefined;
        }
    } else {
        console.warn("Main schema processing resulted in an empty or cyclic definition. Skipping selection file write.");
    }


    // 6. Write Output Schemas (including modification of main schema)
    console.log("\nWriting processed schemas...");
    console.log(`Final cache state before writing:\n${JSON.stringify(processedCache, null, 2)}`);

    let filesWritten = 0;
    const writtenFilesList: string[] = [];
    try {
        for (const originalPath in processedCache) {
            const cacheEntry = processedCache[originalPath];
            let finalSchema = cacheEntry.outputSchema; // Use let as it might be modified

            // Check if finalSchema is valid and not empty before writing
            if (finalSchema && finalSchema !== PROCESSING_MARKER && (typeof finalSchema !== 'object' || Object.keys(finalSchema).length > 0)) {
                const outputAbsPath = getOutputPath(originalPath, baseInputDir, baseOutputDir);

                // --- Add x-mask-selection to the MAIN schema ---
                if (originalPath === mainSchemaOriginalPath && selectionFileName) {
                    // Make sure finalSchema is an object we can add properties to
                    if (typeof finalSchema === 'object' && finalSchema !== null) {
                        (finalSchema as any)['x-mask-selection'] = selectionFileName; // Value is just the filename
                        console.log(`Added 'x-mask-selection: ${selectionFileName}' to main schema: ${getOutputPath(originalPath, baseInputDir, baseOutputDir)}`); // Log correct output path
                    } else {
                        console.warn(`Cannot add 'x-mask-selection' to main schema as it's not a valid object: ${originalPath}`);
                    }
                }
                // --- End modification ---

                // Ensure the finalSchema is treated as a plain object for writing
                writeSchemaFile(outputAbsPath, finalSchema as Schema, maskSuffix);
                filesWritten++;
                const writtenFileNameWithSuffix = path.basename(outputAbsPath, path.extname(outputAbsPath)) + MASK_SUFFIX + path.extname(outputAbsPath); // Construct name with suffix
                writtenFilesList.push(path.relative(workspaceRoot || baseInputDir, path.join(path.dirname(outputAbsPath), writtenFileNameWithSuffix)));
            } else if (finalSchema === PROCESSING_MARKER) {
                console.warn(`Schema processing for ${originalPath} seems incomplete (marker found in final cache). Not writing file.`);
            } else {
                console.log(`Skipping write for ${originalPath} as processed schema is null or empty.`);
            }
        }
    } catch (error: any) {
        console.error(`Failed during file writing: ${error.message}`);
        throw new Error(`Failed during file writing: ${error.message}`);
    }

    // 7. Final User Feedback
    if (filesWritten > 0) {
        let message = `Successfully generated ${filesWritten} masked schema file(s) in '${path.relative(workspaceRoot || baseInputDir, baseOutputDir)}'.`; // Show relative output dir
        if (selectionFileName) {
            message += ` Selection details saved to '${selectionFileName}'.`;
        }
        message += ` Files: ${writtenFilesList.slice(0, 3).join(', ')}${writtenFilesList.length > 3 ? '...' : ''}`;
        console.log(message);
        vscode.window.showInformationMessage(message);
    } else {
        console.log(`\nSchema processing complete. No non-empty schemas were generated to write.`);
        vscode.window.showWarningMessage("Mask generation finished, but no schema content was selected to be written.");
    }
}
