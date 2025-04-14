# Data Model Masking for VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/YOUR_PUBLISHER.data-model-masking-vscode?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER.data-model-masking-vscode) <!-- TODO: Replace YOUR_PUBLISHER -->
[![Build Status](https://img.shields.io/travis/com/YOUR_GITHUB_USER/YOUR_REPO.svg?branch=main)](https://travis-ci.com/YOUR_GITHUB_USER/YOUR_REPO) <!-- TODO: Replace with your CI link -->

This Visual Studio Code extension provides a visual editor to create "masked" or subset versions of complex JSON or YAML schemas. It allows you to select specific parts of a data model (properties, array items) across multiple referenced files and generate a new set of schema files containing only the selected elements.

This is useful for:

*   Generating client-specific or simplified views of a large backend schema.
*   Creating focused schemas for documentation or specific use cases.
*   Reducing the complexity of schemas shared with consumers.

## Features

*   **Visual Schema Tree Editor:** Interactively select/deselect properties and array items within a webview panel.
*   **JSON & YAML Support:** Works with both JSON (`.json`) and YAML (`.yaml`, `.yml`) schema files.
*   **Handles `$ref`:** Resolves local, relative file references (`$ref`) including navigating up directories (`../`) to build the complete schema picture.
*   **Multi-File Processing:** Processes the main schema and all its referenced dependencies.
*   **Masked Output Generation:** Creates new schema files (suffixed with `.m1` by default) containing only the selected parts, preserving the original relative directory structure.
*   **Selection Persistence:** Saves the selection configuration (`<masked_schema_name>.config.json`) alongside the main generated schema, allowing you to easily re-load and modify previous selections.
*   **Edit Existing Masks:** Open a `.m1` masked file to automatically load the original schema and the saved selection configuration for further editing.
*   **Cycle Detection:** Basic handling for circular `$ref` dependencies during processing.
*   **Configurable Output:** Specify a custom output directory for the generated files (defaults to `./output_schemas` relative to the workspace root or input schema).
*   **Theme Aware:** Adapts to VS Code's light and dark themes.

## Usage

### Installation

1.  Install the extension from the Visual Studio Code Marketplace. <!-- TODO: Replace YOUR_PUBLISHER -->

### Opening the Mask Editor

You can open the editor in several ways:

1.  **From the File Explorer:** Right-click on a JSON or YAML schema file and select "**Data Model Masking: Open Schema File**".
2.  **From an Open Editor:** With a schema file open and active, open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and run the command "**Data Model Masking: Open Schema File**".

### Using the Editor

1.  The "Mask Editor" webview will open, displaying a tree representation of your schema.
2.  Use the checkboxes next to properties and array items (`items`) to select the parts you want to include in the masked output.
    *   Checking a parent object/array implicitly selects its basic type definition.
    *   Expand objects/arrays to select nested elements individually.
    *   Selecting a `$ref` implicitly selects its target. You can expand the `$ref` node to control the selection *within* the referenced schema.
3.  **(Optional)** Click the "Browse..." button to select a different output directory for the generated files. The default is `./output_schemas` in your workspace root.
4.  Click the "**Create Mask**" button.

### Output

*   The extension will process the schema and its references based on your selections.
*   New masked schema files will be created in the specified output directory.
    *   Files are named `<original_name>.m1.<original_extension>` (e.g., `Pet.v1.m1.yaml`).
    *   The relative directory structure from the input base directory is preserved in the output directory.
*   For the *main* schema you initially opened, a configuration file named `<masked_schema_name>.config.json` (e.g., `Pet.v1.m1.config.json`) will be saved in the same output directory. This file stores your selection choices and the output directory setting.
*   The main masked schema file will contain an `x-mask-selection` property pointing to this configuration filename.

### Editing an Existing Mask

1.  Open a previously generated `.m1` schema file using the "**Data Model Masking: Open Schema File**" command (either via right-click or the command palette).
2.  The extension will:
    *   Attempt to find the corresponding original schema file (by removing the `.m1` suffix).
    *   Read the `x-mask-selection` property to find the associated `.config.json` file.
    *   Load the *original* schema structure into the editor.
    *   Pre-populate the checkboxes based on the saved selection in the `.config.json` file.
    *   Set the output directory based on the saved configuration.
3.  You can now modify the selection and click "**Create Mask**" again to overwrite the previous output or generate it in a new location.

## How it Works

1.  **Payload Generation (`src/utils.ts:generatePayload`):** When you open a schema, the extension host recursively loads the main schema and all schemas referenced via relative `$ref`s. It builds a `SchemaPayload` containing all schema definitions, keyed by their paths relative to the main schema's directory (`mainSchemaBasePath`).
2.  **Webview UI (`webview-ui`):** The React-based webview receives the `SchemaPayload`. It renders the schema tree based on the `mainSchemaId`. When encountering `$ref`s during rendering or interaction, it uses `webview-ui/src/utils/schemaUtils.ts:resolveRefUri` to calculate the correct relative key to look up the referenced schema within the received `schemas` map.
3.  **Selection State:** The webview maintains the user's selection state as a `RootSelection` object (`src/types.ts`).
4.  **Mask Generation (`src/processor.ts:generateMask`):** When "Create Mask" is clicked, the `RootSelection` object (containing the selection details and target output directory) is sent back to the extension host. The `processSchema` function recursively traverses the *original* schema structure (re-loading files as needed), guided by the `selection` object, and builds the new, masked schema objects. It handles `$ref` rewriting to point to the corresponding masked output files.
5.  **File Writing (`src/utils.ts:writeSchemaFile`):** The generated masked schemas and the selection configuration file are written to the specified output directory, adding the `.m1` suffix to schema files.

## Development

### Prerequisites

*   Node.js (LTS recommended)
*   npm or yarn
*   VS Code

### Setup

1.  Clone the repository:
    ```bash
    git clone https://github.com/YOUR_GITHUB_USER/YOUR_REPO.git # TODO: Update URL
    cd data-model-masking-vscode
    ```
2.  Install root dependencies (compiles TypeScript, runs extension host):
    ```bash
    npm install
    # or
    yarn install
    ```
3.  Install webview UI dependencies:
    ```bash
    cd webview-ui
    npm install
    # or
    yarn install
    cd ..
    ```
4.  Build the webview UI:
    ```bash
    cd webview-ui
    npm run build
    # or
    yarn build
    cd ..
    ```
    *(This creates the necessary static assets in `webview-ui/build`)*

### Running in VS Code

1.  Open the project folder (`data-model-masking-vscode`) in VS Code.
2.  Press `F5` to start a new VS Code instance with the extension loaded (Extension Development Host).
3.  In the new instance, open a folder containing JSON/YAML schemas and use the extension's commands.

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

1.  Fork the repository.
2.  Create a new branch (`git checkout -b feature/your-feature-name`).
3.  Make your changes.
4.  Ensure the code compiles and the webview builds (`npm run compile` in root, `npm run build` in `webview-ui`).
5.  Commit your changes (`git commit -am 'Add some feature'`).
6.  Push to the branch (`git push origin feature/your-feature-name`).
7.  Open a Pull Request.

## License

<!-- TODO: Specify your license -->
MIT or specify otherwise.
