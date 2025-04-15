import fs from 'fs';
import jsYaml from 'js-yaml';
import * as vscode from 'vscode';
import * as path from 'path';

export function getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
}

import { Schema, SchemaMap, SchemaPayload } from './types';

/**
 * Parses a schema string (JSON or YAML) into an object.
 */
export function parseSchemaString(schemaString: string, filePath: string): Schema {
    try {
        // Try parsing as JSON first
        return JSON.parse(schemaString);
    } catch (jsonError: any) { // <-- Explicitly type as 'any'
        try {
            // If JSON parsing fails, try parsing as YAML
            const parsedYaml = jsYaml.load(schemaString);
            if (typeof parsedYaml !== 'object' || parsedYaml === null) {
                throw new Error(`YAML content in ${filePath} did not parse to an object.`);
            }
            return parsedYaml as Schema;
        } catch (yamlError: any) {
            console.error(`Failed to parse schema file ${filePath} as JSON or YAML.`);
            // Now this is allowed because jsonError is 'any'
            console.error("JSON Error:", jsonError.message);
            console.error("YAML Error:", yamlError.message);
            throw new Error(`Invalid schema format in ${filePath}. Must be valid JSON or YAML.`);
        }
    }
}

/**
 * Reads and parses a schema file.
 */
export function loadSchemaFile(filePath: string): Schema {
    console.log(`Loading schema file: ${filePath}`)
    try {
        const absolutePath = path.resolve(filePath);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Schema file not found: ${absolutePath}`);
        }
        const fileContent = fs.readFileSync(absolutePath, 'utf-8');
        return parseSchemaString(fileContent, absolutePath);
    } catch (error: any) {
        console.error(`Error loading schema file ${filePath}: ${error.message}`);
        throw error; // Re-throw to halt execution if a schema can't be loaded
    }
}

/**
 * Resolves a relative $ref path against the directory of the current schema file.
 * Returns the absolute path of the referenced schema.
 */
export function resolveRefPath(ref: string, currentSchemaPath: string): string {
    if (!path.isAbsolute(currentSchemaPath)) {
        throw new Error(`Current schema path must be absolute for ref resolution: ${currentSchemaPath}`);
    }
    const currentSchemaDir = path.dirname(currentSchemaPath);
    // Resolve the ref relative to the directory of the schema containing the ref
    const resolvedPath = path.resolve(currentSchemaDir, ref);
    return resolvedPath;
}

/**
 * Generates the output path for a processed schema, maintaining relative structure.
 */
export function getOutputPath(
    originalAbsolutePath: string,
    baseInputDir: string,
    baseOutputDir: string
): string {
    const relativePath = path.relative(baseInputDir, originalAbsolutePath);
    return path.join(baseOutputDir, relativePath);
}

/**
 * Writes the generated schema to a file, creating directories if needed.
 * Uses the provided suffix to name the output file.
 */
// *** CHANGE: Add maskSuffix parameter ***
export function writeSchemaFile(filePath: string, schema: Schema, maskSuffix: string): void {
    // *** REMOVE: Hardcoded suffix ***
    // const suffix = '.m1'; // Define the suffix to add

    try {
        // 1. Separate directory, base filename, and extension
        const dir = path.dirname(filePath);
        const ext = path.extname(filePath); // e.g., ".json"
        const baseName = path.basename(filePath, ext); // e.g., "schema"

        // 2. Construct the new filename with the provided suffix
        // *** CHANGE: Use maskSuffix parameter ***
        const newFileName = `${baseName}${maskSuffix}${ext}`; // e.g., "schema_mask_v2.json"
        const newFilePath = path.join(dir, newFileName); // Construct the full new path

        // 3. Ensure the directory exists (using the original directory path)
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // 4. Stringify the schema content
        const content = JSON.stringify(schema, null, 2);

        // 5. Write the file using the NEW path
        fs.writeFileSync(newFilePath, content, 'utf-8');
        console.log(`Successfully wrote masked schema to: ${newFilePath}`); // Log the new path

    } catch (error: any) {
        // Log error with the intended original path for context, maybe? Or new path?
        // Let's use newFilePath as that's where the write failed.
        // *** CHANGE: Use maskSuffix parameter in error reporting if needed (though newFilePath is likely best) ***
        const newFilePathForError = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${maskSuffix}${path.extname(filePath)}`);
        console.error(`Error writing masked schema file ${newFilePathForError}: ${error.message}`);
        throw error; // Re-throw to propagate the error
    }
}

/**
 * 
 * Payload generator related code - START
 * 
 */

// Helper function to recursively find $refs and trigger processing
const findAndProcessRefs = (
    schemaObject: any, // Current object/fragment being scanned
    currentSchemaPath: string, // Absolute path of the file this object came from
    basePath: string, // The base directory to make IDs relative to
    schemasMap: SchemaMap, // Accumulator for all schemas
    processedPaths: Set<string> // Tracks absolute paths being processed/done
): void => {
    if (typeof schemaObject !== 'object' || schemaObject === null) {
        return; // Not an object or null, nothing to scan
    }

    // Check for $ref at the current level
    if (typeof schemaObject.$ref === 'string') {
        const refPath = schemaObject.$ref;
        try {
            const resolvedPath = resolveRefPath(refPath, currentSchemaPath);
            // Trigger processing for the referenced file if not already done/in progress
            // eslint-disable-next-line @typescript-eslint/no-use-before-define -- Recursive function definition
            processSchemaFile(resolvedPath, basePath, schemasMap, processedPaths);
        } catch (error) {
            console.warn(`[${currentSchemaPath}] Warning processing $ref "${refPath}": ${(error as Error).message}`);
        }
    }

    // Recursively scan known object/array keywords that contain schemas
    for (const key in schemaObject) {
        if (!schemaObject.hasOwnProperty(key)) continue;

        const value = schemaObject[key];

        if (typeof value !== 'object' || value === null) continue; // Skip non-objects/nulls

        switch (key) {
            case 'properties':
            case 'patternProperties':
            case 'definitions': // OpenAPI uses 'components/schemas' often, but handle 'definitions' too
                // Value is an object where each property value is a schema
                for (const propKey in value) {
                    if (value.hasOwnProperty(propKey)) {
                        findAndProcessRefs(value[propKey], currentSchemaPath, basePath, schemasMap, processedPaths);
                    }
                }
                break;

            case 'items':
                // items can be a single schema object or an array of schemas (tuple validation)
                if (Array.isArray(value)) {
                    value.forEach(itemSchema => findAndProcessRefs(itemSchema, currentSchemaPath, basePath, schemasMap, processedPaths));
                } else {
                    findAndProcessRefs(value, currentSchemaPath, basePath, schemasMap, processedPaths);
                }
                break;

            case 'allOf':
            case 'anyOf':
            case 'oneOf':
                // Value is an array of schemas
                if (Array.isArray(value)) {
                    value.forEach(itemSchema => findAndProcessRefs(itemSchema, currentSchemaPath, basePath, schemasMap, processedPaths));
                }
                break;

            case 'not':
            case 'additionalProperties': // Can be boolean or schema object
            case 'additionalItems': // Can be boolean or schema object
                // Value is a single schema object (if not boolean)
                findAndProcessRefs(value, currentSchemaPath, basePath, schemasMap, processedPaths);
                break;

            // Add other keywords if necessary (e.g., specific OpenAPI extensions)

            default:
                // For unknown keys, we could potentially recurse, but it might be too broad.
                // Sticking to known schema structure keywords is safer.
                break;
        }
    }
};

// Main recursive function to process a schema file
const processSchemaFile = (
    absoluteFilePath: string,
    basePath: string, // Base directory for relative ID calculation
    schemasMap: SchemaMap, // Accumulator object
    processedPaths: Set<string> // Set to track processed absolute paths
): void => {
    try {
        // --- Cycle Detection & Avoid Redundant Work ---
        if (processedPaths.has(absoluteFilePath)) {
            // console.log(`Skipping already processed: ${absoluteFilePath}`);
            return;
        }
        console.log(`Processing: ${absoluteFilePath}`);
        processedPaths.add(absoluteFilePath); // Mark as processed

        // --- Load and Parse ---
        const schema = loadSchemaFile(absoluteFilePath); // Uses your existing loader

        // --- Calculate Relative ID ---
        // Use forward slashes for consistent IDs, relative to the base path
        const relativeId = path.relative(basePath, absoluteFilePath).replace(/\\/g, '/');

        // --- Store in Map ---
        schemasMap[relativeId] = schema;

        // --- Find and Process Nested $refs ---
        findAndProcessRefs(schema, absoluteFilePath, basePath, schemasMap, processedPaths);

    } catch (error) {
        console.error(`Error processing file ${absoluteFilePath}: ${(error as Error).message}`);
        // Decide if you want to stop or continue on error
        // throw error; // Uncomment to stop on first error
    }
};


/**
 * 
 * Payload generator related code - START
 * 
 */
export async function generatePayload(mainSchemaInputPath: string): Promise<string | undefined> {
    console.log(`Starting generatePayload() with mainSchemaInputPath: ${mainSchemaInputPath}`);

    // 2. Resolve Paths
    const absoluteMainSchemaPath = path.resolve(mainSchemaInputPath);
    // Define the base path for relative ID calculation (e.g., the directory containing main schema)
    const basePath = path.dirname(absoluteMainSchemaPath);

    console.log(`Starting schema processing from: ${absoluteMainSchemaPath}`);
    console.log(`Using base path for IDs: ${basePath}`);

    // 3. Initialize Accumulators
    const schemasMap: SchemaMap = {};
    const processedPaths: Set<string> = new Set();

    // 4. Start Recursive Processing
    processSchemaFile(absoluteMainSchemaPath, basePath, schemasMap, processedPaths);

    // 5. Create Final Payload
    const mainSchemaRelativeId = path.relative(basePath, absoluteMainSchemaPath).replace(/\\/g, '/');
    const payload: SchemaPayload = {
        mainSchemaId: mainSchemaRelativeId,
        mainSchemaBasePath: basePath,
        schemas: schemasMap,
        // selection: undefined // Optionally add initial selection here if needed
    };

    // 6. Write Output File
    const payloadString = JSON.stringify(payload, null, 2);
    return payloadString;
};

/**
 * 
 * Payload generator related code - END
 * 
 */


// Helper function to map VS Code theme kind to simple names
export function getThemeName(kind: vscode.ColorThemeKind): 'light' | 'dark' {
  switch (kind) {
      case vscode.ColorThemeKind.Light:
          return 'light';
      case vscode.ColorThemeKind.Dark:
      case vscode.ColorThemeKind.HighContrast: // Treat HighContrast as dark for simplicity
      default:
          return 'dark';
  }
}