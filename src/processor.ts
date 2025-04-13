import fs from 'fs';
import path from 'path';
import { Schema as SchemaType, Schema, SelectionValue, RootSelection } from './types';
import { loadSchemaFile, resolveRefPath, getOutputPath, writeSchemaFile } from './utils';

export const PROCESSING_MARKER = { __processing_marker__: true };

// --- Configuration ---
const DEFAULT_OUTPUT_DIR = './output_schemas';

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
    for (const key in originalSchema) {
        if (key !== 'properties' && key !== 'items' && key !== '$ref' &&
            key !== 'required' && key !== 'definitions' && key !== 'allOf' &&
            key !== 'anyOf' && key !== 'oneOf' && key !== 'not')
        {
            // Ensure we don't copy empty objects/arrays that might be handled later
            if (typeof originalSchema[key] !== 'object' || originalSchema[key] === null || Array.isArray(originalSchema[key]) || Object.keys(originalSchema[key]).length > 0) {
               outputSchema[key] = originalSchema[key];
            }
        }
    }
    // If selection is true, any copied basic keyword means we have content.
    // If selection is an object, we need to wait until properties/items/ref are processed.
    if (selection === true && Object.keys(outputSchema).length > 0) {
        hasSelectedContent = true;
    }
    // Add specific keyword selection based on SelectionDetail if needed here...


    // --- Handle $ref ---
    if (originalSchema.$ref) {
        const refAbsolutePath = resolveRefPath(originalSchema.$ref, originalSchemaPath);
        // Determine the selection for the target: Use $refTargetSelection if available in detail, otherwise default to true.
        const refSelection = (selection !== true && selection?.$refTargetSelection) ? selection.$refTargetSelection : true;

        let processedRefSchemaResult: SchemaType | null | typeof PROCESSING_MARKER = null;
        let refNeedsProcessing = false;

        // Only process the ref if the selection isn't explicitly false
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
                     if (refCacheEntry.outputSchema === PROCESSING_MARKER) {
                         console.log(`Ref target ${refAbsolutePath} is currently being processed (cycle detected).`);
                         processedRefSchemaResult = PROCESSING_MARKER;
                     } else {
                         console.log(`Ref target ${refAbsolutePath} was already fully processed.`);
                         processedRefSchemaResult = refCacheEntry.outputSchema;
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
                        true // This is a top-level call for the referenced file
                    );
                }

            } catch (error: any) {
                console.error(`Error processing $ref "${originalSchema.$ref}" in ${originalSchemaPath}: ${error.message}`);
                processedRefSchemaResult = null;
            }

            if (processedRefSchemaResult === PROCESSING_MARKER || (processedRefSchemaResult && Object.keys(processedRefSchemaResult).length > 0)) {
                const currentOutputSchemaPath = getOutputPath(originalSchemaPath, baseInputDir, baseOutputDir);
                const refOutputPath = getOutputPath(refAbsolutePath, baseInputDir, baseOutputDir);
                let refOutputRelativePath = path.relative(path.dirname(currentOutputSchemaPath), refOutputPath);
                refOutputRelativePath = refOutputRelativePath.replace(/\\/g, '/');
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

        // --- Store result and return (after $ref handling) ---
        // This block was slightly misplaced before, should be outside the $ref check
        // if (isTopLevelCall) {
        //     const finalResultSchema = hasSelectedContent ? outputSchema : null;
        //     processedCache[originalSchemaPath] = { outputSchema: finalResultSchema };
        //     console.log(`Finished processing (top-level, with $ref logic): ${originalSchemaPath}`);
        //     return finalResultSchema;
        // } else {
        //      console.log(`Finished processing (inline, with $ref logic) within: ${originalSchemaPath}`);
        //     return hasSelectedContent ? outputSchema : null;
        // }
        // --> Moved final return/cache update to the end of the function
    } // End $ref handling


    // --- Handle properties (Objects) ---
    // MODIFIED Condition: Process if selection is true OR if selection is an object with properties defined
    if (originalSchema.properties && (selection === true || selection?.properties)) {
        const outputProperties: { [key: string]: SchemaType } = {};
        const outputRequired: string[] = [];
        let hasSelectedProperties = false;

        // Iterate over the *original* schema's properties
        for (const propKey in originalSchema.properties) {
            if (originalSchema.properties.hasOwnProperty(propKey)) {
                // Determine the selection for this specific property:
                // If main selection is true, select the prop (pass true down).
                // If main selection is an object, use the specific prop selection from it (or undefined if not present).
                const propSelection = selection === true ? true : selection.properties?.[propKey];

                // Only process if the property is actually selected (propSelection is true or a SelectionDetail object)
                if (propSelection) {
                    const propSchema = originalSchema.properties[propKey];
                    const processedPropSchemaResult = processSchema(
                        propSchema,
                        propSelection, // Pass the determined selection for the property
                        originalSchemaPath,
                        baseInputDir,
                        baseOutputDir,
                        processedCache,
                        false // Not a top-level call
                    );

                    if (processedPropSchemaResult && processedPropSchemaResult !== PROCESSING_MARKER) {
                        outputProperties[propKey] = processedPropSchemaResult;
                        hasSelectedProperties = true;
                        // Check original required array
                        if (originalSchema.required?.includes(propKey)) {
                            outputRequired.push(propKey);
                        }
                    } else if (processedPropSchemaResult === PROCESSING_MARKER) {
                        console.error(`DEV ERROR: PROCESSING_MARKER unexpectedly returned for property '${propKey}' in ${originalSchemaPath}. Check for nested $ref cycles.`);
                    } else {
                         console.log(`Property '${propKey}' in ${originalSchemaPath} processed to null/empty.`);
                    }
                } else {
                     console.log(`Property '${propKey}' in ${originalSchemaPath} was not selected.`);
                }
            }
        }

        if (hasSelectedProperties) {
            if (!outputSchema.type && originalSchema.type === 'object') outputSchema.type = 'object';
            outputSchema.properties = outputProperties;
            if (outputRequired.length > 0) {
                outputSchema.required = outputRequired;
            }
            hasSelectedContent = true; // We added properties
        } else if (outputSchema.type === 'object' && Object.keys(outputSchema).length === 1 && !originalSchema.$ref) {
             // Clean up 'type: object' if no properties were selected AND there wasn't a $ref handled above
             // (If $ref was handled, it might have cleared outputSchema already)
             delete outputSchema.type;
        }
    }

    // --- Handle items (Arrays) ---
    // MODIFIED Condition: Process if selection is true OR if selection is an object with items defined
    if (originalSchema.items && typeof originalSchema.items === 'object' && !Array.isArray(originalSchema.items) && (selection === true || selection?.items)) {
        // Determine the selection for items:
        // If main selection is true, select items (pass true down).
        // If main selection is an object, use the specific items selection from it.
        const itemsSelection = selection === true ? true : selection.items;

        // Only process if items are actually selected (itemsSelection is true or a SelectionDetail object)
        if (itemsSelection) {
            const processedItemsSchemaResult = processSchema(
                originalSchema.items as SchemaType,
                itemsSelection, // Pass the determined selection for items
                originalSchemaPath,
                baseInputDir,
                baseOutputDir,
                processedCache,
                false // Not a top-level call
            );

            if (processedItemsSchemaResult && processedItemsSchemaResult !== PROCESSING_MARKER) {
                if (!outputSchema.type && originalSchema.type === 'array') outputSchema.type = 'array';
                outputSchema.items = processedItemsSchemaResult;
                hasSelectedContent = true; // We added items
            } else if (processedItemsSchemaResult === PROCESSING_MARKER) {
                 console.error(`DEV ERROR: PROCESSING_MARKER unexpectedly returned for items in ${originalSchemaPath}. Check for nested $ref cycles.`);
            } else if (outputSchema.type === 'array' && Object.keys(outputSchema).length === 1 && !originalSchema.$ref) {
                 // Clean up 'type: array' if no items resulted AND there wasn't a $ref handled above
                 delete outputSchema.type;
            }
        } else {
             console.log(`Items in ${originalSchemaPath} were not selected.`);
        }
    }

    // --- Final Step: Update cache (only if top-level) and return ---
    // Ensure this runs *after* all processing ($ref, properties, items) is complete
    const finalResult = hasSelectedContent ? outputSchema : null;

    if (isTopLevelCall) {
        processedCache[originalSchemaPath] = { outputSchema: finalResult };
        console.log(`Finished processing (top-level): ${originalSchemaPath} -> ${finalResult ? 'Schema generated' : 'Result is null'}`);
    } else {
         console.log(`Finished processing (inline): ${originalSchemaPath} -> ${finalResult ? 'Schema generated' : 'Result is null'}`);
    }

    return finalResult;
}

/**
 * 
 * Generating the mask
 * 
 */
export async function generateMask(workspaceBasePath: string, selection: string): Promise<void> {
    // // 1. Read Selection Definition (Unchanged)
    // const selectionFilePath = process.argv[2];
    // if (!selectionFilePath) {
    //   console.error("Usage: node dist/index.js <path_to_selection.json>");
    //   process.exit(1);
    // }
    let rootSelection: RootSelection = JSON.parse(selection);
    // try {
    //   const selectionFileContent = fs.readFileSync(path.resolve(selectionFilePath), 'utf-8');
    //   rootSelection = JSON.parse(selectionFileContent);
    //   if (!rootSelection.mainSchemaId || typeof rootSelection.mainSchemaId !== 'string') {
    //       throw new Error("Selection file must contain a 'mainSchemaId' (string).");
    //   }
    //    if (!rootSelection.selection || typeof rootSelection.selection !== 'object') {
    //       throw new Error("Selection file must contain a 'selection' object.");
    //   }
    // } catch (error: any) {
    //   console.error(`Error reading or parsing selection file ${selectionFilePath}: ${error.message}`);
    //   process.exit(1);
    // }
  
    // 2. Determine Paths (Unchanged)
    const mainSchemaOriginalPath = path.resolve(rootSelection.mainSchemaBasePath, rootSelection.mainSchemaId);
    const baseInputDir = rootSelection.mainSchemaBasePath;
    const baseOutputDir = path.resolve(workspaceBasePath, rootSelection.outputDir || DEFAULT_OUTPUT_DIR);
  
    console.log(`Processing main schema: ${mainSchemaOriginalPath}`);
    console.log(`Using base input directory: ${baseInputDir}`);
    console.log(`Using base output directory: ${baseOutputDir}`);
  
    // 3. Initialize Cache
    const processedCache: ProcessingCache = {}; // Use the new cache type
  
    // 4. Load and Process Main Schema
    let mainProcessingResult: Schema | null | typeof PROCESSING_MARKER = null;
    try {
      const mainSchema = loadSchemaFile(mainSchemaOriginalPath);
  
      // No need to pre-populate cache or handle main schema cache entry manually here.
      // processSchema handles its own entry and updates.
  
      mainProcessingResult = processSchema(
        mainSchema,
        rootSelection.selection,
        mainSchemaOriginalPath,
        baseInputDir,
        baseOutputDir,
        processedCache // Pass the cache
      );
  
      // The cache is now populated by all processSchema calls.
  
    } catch (error: any) {
      console.error(`Failed to process main schema: ${error.message}`);
      if (error.stack) console.error(error.stack); // Log stack for better debugging
      process.exit(1);
    }
  
    // 5. Write Output Schemas
    if (!mainProcessingResult || mainProcessingResult === PROCESSING_MARKER) {
      console.warn("Processing resulted in an empty or cyclic main schema definition. Inspect cache and logs.");
      // Optionally print cache content for debugging even if not writing files
      console.log(`Final cache state:\n${JSON.stringify(processedCache, null, 2)}`);
      process.exit(0); // Exit gracefully, nothing to write for main schema
    }
  
    console.log("\nWriting processed schemas...");
    console.log(`Final cache state before writing:\n${JSON.stringify(processedCache, null, 2)}`);
  
    // Write all schemas collected in the cache
    let filesWritten = 0;
    try {
      for (const originalPath in processedCache) {
          const cacheEntry = processedCache[originalPath];
          const finalSchema = cacheEntry.outputSchema;
  
          // Check if outputSchema exists, is not the processing marker, and is not empty
          if (finalSchema &&
              finalSchema !== PROCESSING_MARKER &&
              Object.keys(finalSchema).length > 0)
          {
              const outputAbsPath = getOutputPath(originalPath, baseInputDir, baseOutputDir);
              // Ensure the finalSchema is treated as a plain object for writing
              writeSchemaFile(outputAbsPath, finalSchema as Schema);
              filesWritten++;
          } else if (finalSchema === PROCESSING_MARKER) {
               console.warn(`Schema processing for ${originalPath} seems incomplete (marker found in final cache). Not writing file.`);
          } else {
               // Schema processed to null or empty object
               console.log(`Skipping write for ${originalPath} as processed schema is null or empty.`);
          }
      }
    } catch (error: any) {
      console.error(`Failed during file writing: ${error.message}`);
      process.exit(1);
    }
  
    if (filesWritten > 0) {
        console.log(`\nSchema processing complete. ${filesWritten} file(s) written.`);
    } else {
        console.log(`\nSchema processing complete. No non-empty schemas were generated to write.`);
    }
  }