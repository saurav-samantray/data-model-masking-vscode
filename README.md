# JSON Schema Viewer VS Code Extension

This project is a Visual Studio Code extension that allows you to view JSON schemas within a webview. It utilizes a React application built with TypeScript and the `@stoplight/json-schema-viewer` library to render the schemas.


## Prerequisites

*   **Node.js:** Make sure you have Node.js (version 16 or higher) installed.
*   **npm:** Node Package Manager (usually comes with Node.js).
*   **Visual Studio Code:** The editor where you'll run the extension.

## Installation

1.  **Clone the Repository:**
    ```bash
    git clone <repository-url>
    cd json-schema-viewer-extension
    ```

2.  **Install Extension Dependencies:**
    ```bash
    npm install
    ```

3.  **Install Webview Dependencies:**
    ```bash
    cd webview-ui
    npm install
    cd ..
    ```

## Building the Project

1.  **Build the Webview (React App):**
    ```bash
    npm run build-webview
    ```
    This command will build the React application and place the output in the `webview-ui/dist` directory.

2.  **Compile the Extension (TypeScript):**
    ```bash
    npm run compile
    ```
    This command will compile the TypeScript code in the `src` directory and place the JavaScript output in the `out` directory.

## Running the Extension

1.  **Open in VS Code:**
    Open the `json-schema-viewer-extension` directory in Visual Studio Code.

2.  **Run and Debug:**
    *   Go to the "Run and Debug" view (Ctrl+Shift+D or Cmd+Shift+D).
    *   Select "Run Extension" from the dropdown.
    *   Press F5 to start debugging.

3.  **Open the webview:**
    * Open the command pallete (Ctrl+Shift+P or Cmd+Shift+P)
    * Type `Show JSON Schema Viewer` and select it.

## Development

1.  **Watch Mode (Extension):**
    For continuous development of the extension, you can use watch mode:
    ```bash
    npm run watch
    ```
    This will automatically recompile the extension code whenever you make changes.

2.  **Development Mode (Webview):**
    For continuous development of the webview, you can use the vite dev server:
    ```bash
    cd webview-ui
    npm run dev
    ```
    This will start a dev server for the webview.

## Key Commands

*   `npm run compile`: Compiles the extension's TypeScript code.
*   `npm run watch`: Compiles the extension's TypeScript code in watch mode.
*   `npm run build-webview`: Builds the React webview application.
*   `npm run install-webview`: Installs the dependencies of the webview.
*   `npm run dev`: Starts the vite dev server for the webview.

## Features

*   **JSON Schema Viewing:** Displays JSON schemas in a user-friendly format using the `@stoplight/json-schema-viewer` library.
*   **VS Code Integration:** Seamlessly integrates with VS Code as a webview.
*   **Sidebar:** The extension adds a sidebar to the activity bar.
*   **Command:** The extension adds a command to open the webview.

## Dependencies

### Extension

*   `vscode-webview-ui-toolkit`: For creating webview UI elements.

### Webview

*   `@stoplight/json-schema-viewer`: For rendering JSON schemas.
*   `@types/vscode`: TypeScript definitions for the VS Code API.
*   `lucide-react`: For icons.
*   `react`: The React library.
*   `react-dom`: For rendering React components in the DOM.

## Contributing

Contributions are welcome! Please feel free to open issues or submit pull requests.

## License

[Your License] (e.g., MIT)
